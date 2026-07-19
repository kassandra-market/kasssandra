import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { Card } from '../../components/ui'

/** Disconnected gate with copy tailored to creating an oracle. */
export function ConnectPrompt() {
  const { setVisible } = useWalletModal()
  return (
    <Card className="flex flex-wrap items-center gap-3">
      <p className="font-inter text-[15px] text-silver">Connect a wallet to create an oracle.</p>
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="rounded-button border border-hairline bg-liquid-deep px-4 py-2 font-inter text-[13px] text-platinum hover:bg-hairline/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hairline focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss"
      >
        Connect wallet
      </button>
    </Card>
  )
}
