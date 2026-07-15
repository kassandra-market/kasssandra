/**
 * Real-wallet integration on the **Wallet Standard** (`@wallet-standard/react`),
 * replacing the legacy `@solana/wallet-adapter` `StandardWalletAdapter` — which is
 * broken here: built against `@solana/web3.js@3.x` while it peer-requires 1.x, it
 * hands Phantom a malformed request and Phantom throws "Unexpected error" on
 * connect.
 *
 * We drive the wallet directly: list wallets, connect an account (per-wallet
 * `useConnect` hook, in the modal rows), and sign with the account's
 * `solana:signTransaction` feature. The app builds a classic `web3.js`
 * transaction and SENDS it over its OWN RPC connection (so it works against a
 * local surfpool RPC without needing the wallet's network configured for send).
 *
 * The provider exposes the SAME `WalletContextState` the app already consumes via
 * `useWallet()`, so nothing downstream changes; the picker is a small custom
 * modal (`useWalletMenu`) since the wallet-adapter-react-ui modal is tied to the
 * legacy adapter.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { WalletContext, type WalletContextState } from '@solana/wallet-adapter-react'
import { Address, Transaction, type Connection } from '@solana/web3.js'
import { getWalletAccountFeature, useWallets, type UiWallet, type UiWalletAccount } from '@wallet-standard/react'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'

/** Pick a Solana chain the account advertises (any — the app sends over its own RPC). */
function solanaChain(account: UiWalletAccount): `solana:${string}` {
  const c = account.chains.find((x): x is `solana:${string}` => x.startsWith('solana:'))
  return c ?? 'solana:mainnet'
}

/**
 * Sign a prepared (feePayer + blockhash already set) legacy transaction with the
 * account's Wallet-Standard `solana:signTransaction` feature, returning the fully
 * signed WIRE bytes. Shared by both write paths: the oracle `sendTransaction`
 * (relays these bytes over its RPC) and the markets `signTransaction` (rehydrates
 * a `Transaction` the indexer relay serializes + submits).
 */
async function signWithAccount(account: UiWalletAccount, tx: Transaction): Promise<Uint8Array> {
  const wire = await tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  // NOTE (needs live-wallet validation): the exact Wallet-Standard
  // `signTransaction` input shape (esp. the `account` — UiWalletAccount vs the
  // underlying WalletAccount) is the one bit we can't verify without a browser
  // wallet, so the feature is typed permissively here.
  const getFeature = getWalletAccountFeature as (a: UiWalletAccount, f: string) => unknown
  const feature = getFeature(account, SolanaSignTransaction) as {
    signTransaction: (input: unknown) => Promise<ReadonlyArray<{ signedTransaction: Uint8Array }>>
  }
  const [{ signedTransaction }] = await feature.signTransaction({
    account,
    transaction: wire,
    chain: solanaChain(account),
  })
  return signedTransaction
}

interface WalletMenuValue {
  wallets: readonly UiWallet[]
  open: boolean
  setOpen: (o: boolean) => void
  /** Called by a modal row after a successful per-wallet connect. */
  adopt: (account: UiWalletAccount) => void
}
/** No-op default so NavBar / ConnectGate (rendered in every wallet mode) can call
 *  `openPicker` unconditionally; in E2E/mock modes the wallet is auto-connected,
 *  so the picker is never actually needed. */
const NOOP_MENU: WalletMenuValue = { wallets: [], open: false, setOpen: () => {}, adopt: () => {} }
const WalletMenuContext = createContext<WalletMenuValue>(NOOP_MENU)
export function useWalletMenu(): WalletMenuValue {
  return useContext(WalletMenuContext)
}

export function StandardWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useWallets()
  const [account, setAccount] = useState<UiWalletAccount | null>(null)
  const [open, setOpen] = useState(false)

  const publicKey = useMemo(() => (account ? new Address(account.address) : null), [account])

  // The oracle write path: sign locally, then SEND over the passed RPC connection.
  const sendTransaction = useCallback(
    async (tx: Transaction, connection: Connection): Promise<string> => {
      if (!account || !publicKey) throw new Error('wallet not connected')
      tx.feePayer = publicKey
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
      const signed = await signWithAccount(account, tx)
      return connection.sendRawTransaction(signed, { skipPreflight: false })
    },
    [account, publicKey],
  )

  // The markets write path (`signAndRelay`): sign a prepared (feePayer + blockhash
  // already set) tx locally and hand the signed `Transaction` back — the indexer
  // relay serializes + submits it. Without this, the markets `useWriteAction` gate
  // (`!signTransaction → null sender`) misreports a connected wallet as "Connect a
  // wallet to participate." on every trade.
  const signTransaction = useCallback(
    async (tx: Transaction): Promise<Transaction> => {
      if (!account || !publicKey) throw new Error('wallet not connected')
      return Transaction.from(await signWithAccount(account, tx))
    },
    [account, publicKey],
  )

  const disconnect = useCallback(async () => {
    const wallet = wallets.find((w) => w.accounts.some((a) => a.address === account?.address))
    const feat = (wallet?.features as Record<string, { disconnect?: () => Promise<void> }> | undefined)?.[
      'standard:disconnect'
    ]
    await feat?.disconnect?.().catch(() => {})
    setAccount(null)
  }, [wallets, account])

  const value = useMemo<WalletContextState>(
    () =>
      ({
        autoConnect: false,
        wallets: [],
        wallet: null,
        publicKey,
        connecting: false,
        connected: account !== null,
        disconnecting: false,
        select: () => setOpen(true),
        connect: async () => setOpen(true),
        disconnect,
        sendTransaction: sendTransaction as unknown as WalletContextState['sendTransaction'],
        signTransaction: signTransaction as unknown as WalletContextState['signTransaction'],
        signAllTransactions: undefined,
        signMessage: undefined,
        signIn: undefined,
      }) as unknown as WalletContextState,
    [publicKey, account, disconnect, sendTransaction, signTransaction],
  )

  const menu = useMemo<WalletMenuValue>(
    () => ({ wallets, open, setOpen, adopt: setAccount }),
    [wallets, open],
  )

  return (
    <WalletContext.Provider value={value}>
      <WalletMenuContext.Provider value={menu}>{children}</WalletMenuContext.Provider>
    </WalletContext.Provider>
  )
}
