use super::*;
use kassandra_oracles_program::error::KassandraError;
use solana_instruction_error::InstructionError;
use solana_transaction_error::TransactionError;

impl TestCtx {
    /// Fabricate an enabled MagicBlock GPT config + a resolved feed at the
    /// real PDAs, then stamp [`Ix::ApplyExternalAiClaim`] for `proposer`.
    ///
    /// Tests that previously called `submit_ai_claim` go through this helper.
    /// The in-house submit path is retired (`SubmitAiClaimRetired`).
    ///
    /// `option` is written onto the feed (and therefore onto the claim). Tests
    /// that need different options per proposer overwrite the feed between
    /// calls — production always stamps the same GPT option onto every
    /// proposer, but LiteSVM fixtures still cover the multi-option economics
    /// by poking the feed account.
    pub fn stamp_gpt_claim(
        &mut self,
        oracle: Pubkey,
        proposer: Pubkey,
        option: u8,
    ) -> TransactionResult {
        self.ensure_gpt_feed(oracle, option);
        let ix = apply_external_ai_claim_ix(self, oracle, proposer);
        self.send(ix, &[])
    }

    /// Same as [`Self::stamp_gpt_claim`] but panics on failure.
    pub fn stamp_gpt_claim_ok(&mut self, oracle: Pubkey, proposer: Pubkey, option: u8) {
        self.stamp_gpt_claim(oracle, proposer, option)
            .expect("apply_external_ai_claim (GPT feed) should succeed");
    }

    /// Write an enabled GPT config PDA and a resolved feed for `oracle`.
    ///
    /// Feed hashes match the historical in-house test payload (`0xAA`/`0xBB`/`0xCC`)
    /// so existing `AiClaim` metadata assertions stay stable.
    pub fn ensure_gpt_feed(&mut self, oracle: Pubkey, option: u8) {
        let (config_pda, config_bump) =
            Pubkey::find_program_address(&[AiOracleConfig::SEED_PREFIX], &self.program_id);
        let (feed_pda, feed_bump) = Pubkey::find_program_address(
            &[AiOracleFeed::SEED_PREFIX, oracle.as_ref()],
            &self.program_id,
        );

        let mut config = AiOracleConfig::zeroed();
        config.account_type = AccountType::AiOracleConfig.as_u8();
        config.bump = config_bump;
        config.llm_context = Pubkey::new_from_array([0x42; 32]).to_bytes().into();
        config.source = AI_ORACLE_SOURCE_MAGICBLOCK;
        config.enabled = 1;
        config.max_staleness_slots = u64::MAX;
        self.set_program_account(config_pda, bytemuck::bytes_of(&config).to_vec());

        let mut feed = AiOracleFeed::zeroed();
        feed.account_type = AccountType::AiOracleFeed.as_u8();
        feed.bump = feed_bump;
        feed.oracle = oracle.to_bytes().into();
        feed.option = option;
        feed.slot = self.slot();
        feed.timestamp = self.now();
        feed.model_id = [0xAA; 32];
        feed.params_hash = [0xBB; 32];
        feed.io_hash = [0xCC; 32];
        self.set_program_account(feed_pda, bytemuck::bytes_of(&feed).to_vec());
    }
}

/// Build [`Ix::ApplyExternalAiClaim`] through the SDK (locked-in account order).
pub fn apply_external_ai_claim_ix(ctx: &TestCtx, oracle: Pubkey, proposer: Pubkey) -> Instruction {
    let (claim, _) =
        Pubkey::find_program_address(&[b"claim", oracle.as_ref(), proposer.as_ref()], &ctx.program_id);
    let (config, _) =
        Pubkey::find_program_address(&[AiOracleConfig::SEED_PREFIX], &ctx.program_id);
    let (feed, _) = Pubkey::find_program_address(
        &[AiOracleFeed::SEED_PREFIX, oracle.as_ref()],
        &ctx.program_id,
    );
    kassandra_oracles_sdk::ix::apply_external_ai_claim(
        &ctx.program_id,
        oracle,
        proposer,
        claim,
        config,
        feed,
        ctx.payer.pubkey(),
    )
}

/// Assert that Ix 3 (`SubmitAiClaim`) is rejected as retired.
pub fn assert_submit_ai_claim_retired(ctx: &mut TestCtx, oracle: Pubkey, proposer: Pubkey) {
    let (claim, _) =
        Pubkey::find_program_address(&[b"claim", oracle.as_ref(), proposer.as_ref()], &ctx.program_id);
    let ix = submit_ai_claim_ix(
        ctx,
        oracle,
        proposer,
        claim,
        ctx.payer.pubkey(),
        submit_ai_payload(0),
    );
    let err = ctx.send(ix, &[]).expect_err("retired SubmitAiClaim must fail");
    assert_eq!(
        err.err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(KassandraError::SubmitAiClaimRetired as u32),
        ),
        "expected SubmitAiClaimRetired (43)",
    );
}
