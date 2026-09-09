//! Context construction, transaction submission, and account accessors.

use super::{set_program_data, TestCtx};
use litesvm::{types::TransactionResult, LiteSVM};
use solana_sdk::{
    clock::Clock,
    compute_budget::ComputeBudgetInstruction,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

impl TestCtx {
    /// Build a fresh context: a funded payer and the compiled
    /// `kassandra_markets_program` deployed so tests can submit real
    /// transactions via [`TestCtx::send`].
    pub fn new() -> Self {
        Self::from_svm(LiteSVM::new())
    }

    /// Same as [`Self::new`] but with sigverify disabled so GPT identity PDA
    /// can be marked as a signer without a keypair.
    pub fn new_no_sigverify() -> Self {
        Self::from_svm(LiteSVM::new().with_sigverify(false))
    }

    fn from_svm(mut svm: LiteSVM) -> Self {
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 1_000_000_000_000).unwrap();

        let program_id = Pubkey::new_from_array(kassandra_markets_program::ID.to_bytes());
        svm.add_program(
            program_id,
            include_bytes!("../../../../target/deploy/kassandra_markets_program.so"),
        );

        set_program_data(&mut svm, &program_id, &payer.pubkey());

        Self {
            svm,
            payer,
            program_id,
        }
    }

    /// Overwrite the fabricated `ProgramData` account so `authority` becomes the
    /// program's on-chain upgrade authority (for the negative front-run test,
    /// where a non-authority signer must be rejected).
    pub fn set_upgrade_authority(&mut self, authority: &Pubkey) {
        set_program_data(&mut self.svm, &self.program_id, authority);
    }

    /// Deploy the two MetaDAO v0.4 programs (`conditional_vault` + `amm`) into
    /// the SVM from the vendored `.so` fixtures, so activation tests can compose
    /// and CPI into a real MetaDAO market. The bytes are `include_bytes!`'d at
    /// compile time from `tests/fixtures/`.
    pub fn load_metadao(&mut self) {
        const VAULT_SO: &[u8] = include_bytes!("../fixtures/metadao_conditional_vault.so");
        const AMM_SO: &[u8] = include_bytes!("../fixtures/metadao_amm.so");
        // Program IDs (base58): conditional_vault
        // VLTX1ishMBbcX3rdBWGssxawAo1Q2X2qxYFYqiGodVg, amm
        // AMMyu265tkBpRW21iGQxKGLaves3gKm2JcMUqfXNSpqD.
        const VAULT_ID: Pubkey = solana_sdk::pubkey!("VLTX1ishMBbcX3rdBWGssxawAo1Q2X2qxYFYqiGodVg");
        const AMM_ID: Pubkey = solana_sdk::pubkey!("AMMyu265tkBpRW21iGQxKGLaves3gKm2JcMUqfXNSpqD");
        self.svm.add_program(VAULT_ID, VAULT_SO);
        self.svm.add_program(AMM_ID, AMM_SO);
    }

    // ----- transaction submission --------------------------------------------

    /// Sign and submit a single-instruction transaction, returning the LiteSVM
    /// result so tests can assert `Ok`/`Err` and introspect the error.
    ///
    /// Signed by the payer (fee payer) plus every keypair in `extra_signers`.
    /// The blockhash is expired and re-fetched each call so two otherwise
    /// identical transactions get distinct signatures and never collide.
    #[allow(clippy::result_large_err)]
    pub fn send(&mut self, ix: Instruction, extra_signers: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let mut all_signers: Vec<&Keypair> = Vec::with_capacity(extra_signers.len() + 1);
        all_signers.push(&self.payer);
        all_signers.extend_from_slice(extra_signers);
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.payer.pubkey()),
            &all_signers,
            blockhash,
        );
        self.svm.send_transaction(tx)
    }

    /// Sign and submit a multi-instruction transaction (a 1.4M-CU compute budget
    /// is prepended automatically — the MetaDAO composition + `activate` CPIs
    /// exceed the 200k default). Signed by the payer plus `extra_signers`.
    #[allow(clippy::result_large_err)]
    pub fn send_many(
        &mut self,
        ixs: &[Instruction],
        extra_signers: &[&Keypair],
    ) -> TransactionResult {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let mut all_ixs = Vec::with_capacity(ixs.len() + 1);
        all_ixs.push(ComputeBudgetInstruction::set_compute_unit_limit(1_400_000));
        all_ixs.extend_from_slice(ixs);
        let mut all_signers: Vec<&Keypair> = Vec::with_capacity(extra_signers.len() + 1);
        all_signers.push(&self.payer);
        all_signers.extend_from_slice(extra_signers);
        let tx = Transaction::new_signed_with_payer(
            &all_ixs,
            Some(&self.payer.pubkey()),
            &all_signers,
            blockhash,
        );
        self.svm.send_transaction(tx)
    }

    /// Sign only the payer, leaving other required signatures as defaults.
    /// Use with [`Self::new_no_sigverify`] when a PDA must appear as a signer
    /// (GPT-oracle identity) without a corresponding keypair.
    pub fn send_payer_only(&mut self, ix: Instruction) -> TransactionResult {
        use solana_sdk::signature::Signature;
        let blockhash = self.svm.latest_blockhash();
        let message = solana_sdk::message::Message::new(&[ix], Some(&self.payer.pubkey()));
        let n = message.header.num_required_signatures as usize;
        let mut tx = Transaction {
            signatures: vec![Signature::default(); n],
            message,
        };
        tx.partial_sign(&[&self.payer], blockhash);
        self.svm.send_transaction(tx)
    }

    // ----- accessors ---------------------------------------------------------

    /// Read a program account and reinterpret its data as a `Pod` struct `T`.
    ///
    /// Uses [`bytemuck::pod_read_unaligned`] so correctness does not depend on
    /// the alignment of the account-data buffer.
    pub fn read_pod<T: bytemuck::Pod>(&self, key: Pubkey) -> T {
        let acc = self
            .svm
            .get_account(&key)
            .unwrap_or_else(|| panic!("account {key} not found"));
        bytemuck::pod_read_unaligned::<T>(&acc.data)
    }

    /// Current on-chain unix timestamp from the `Clock` sysvar.
    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    /// Advance the `Clock` sysvar's `unix_timestamp` by `secs` (leaving every
    /// other Clock field untouched) — for the activity-scaled min-liquidity
    /// ramp tests, which need to simulate idle time between `create_market`
    /// calls without spinning up real wall-clock delay.
    pub fn advance_clock_secs(&mut self, secs: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    /// Lamports balance of any account (0 if it does not exist).
    pub fn lamports(&self, key: Pubkey) -> u64 {
        self.svm.get_account(&key).map(|a| a.lamports).unwrap_or(0)
    }

    /// Airdrop 1e12 lamports to an arbitrary key (so it exists as a funded
    /// system account, e.g. a rent recipient or extra signer). Later tasks need
    /// to fund keys that are not the payer.
    pub fn svm_airdrop(&mut self, key: &Pubkey) {
        self.svm.airdrop(key, 1_000_000_000_000).unwrap();
    }

    /// Airdrop an EXACT lamport amount to an arbitrary key — used to simulate an
    /// attacker pre-funding a deterministic PDA (the create-or-adopt grief test).
    pub fn prefund(&mut self, key: &Pubkey, lamports: u64) {
        self.svm.airdrop(key, lamports).unwrap();
    }
}
