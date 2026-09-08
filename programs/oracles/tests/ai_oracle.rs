//! External AI oracle: `set_ai_oracle_config` / `request_ai_oracle` /
//! GPT-oracle callback / `apply_external_ai_claim`.

mod common;
use common::*;

use kassandra_oracles_program::{
    cpi::gpt_oracle::{CALLBACK_DISCRIMINATOR, GPT_ORACLE_PROGRAM_ID, IDENTITY_SEED},
    error::KassandraError,
    instruction::Ix,
    state::{AiOracleConfig, AiOracleFeed, Phase, AI_ORACLE_SOURCE_MAGICBLOCK},
};
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_pubkey::Pubkey;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction_error::TransactionError;

fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"ai_oracle_config"], program_id)
}

fn feed_pda(program_id: &Pubkey, oracle: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"ai_feed", oracle.as_ref()], program_id)
}

fn claim_pda(program_id: &Pubkey, oracle: &Pubkey, proposer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"claim", oracle.as_ref(), proposer.as_ref()], program_id)
}

fn gpt_program() -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(GPT_ORACLE_PROGRAM_ID.as_ref());
    Pubkey::new_from_array(b)
}

fn identity_pda() -> Pubkey {
    Pubkey::find_program_address(&[IDENTITY_SEED], &gpt_program()).0
}

fn llm_context() -> Pubkey {
    Pubkey::new_from_array([0x42; 32])
}

fn set_config_ix(
    ctx: &TestCtx,
    protocol: Pubkey,
    config: Pubkey,
    llm_context: Pubkey,
    max_staleness_slots: u64,
    enabled: u8,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 42);
    data.push(Ix::SetAiOracleConfig as u8);
    data.extend_from_slice(llm_context.as_ref());
    data.extend_from_slice(&max_staleness_slots.to_le_bytes());
    data.push(AI_ORACLE_SOURCE_MAGICBLOCK);
    data.push(enabled);
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(protocol, false),
            AccountMeta::new(config, false),
            AccountMeta::new(ctx.payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn request_ix(ctx: &TestCtx, config: Pubkey, oracle: Pubkey, feed: Pubkey, text: &str) -> Instruction {
    let mut data = Vec::with_capacity(5 + text.len());
    data.push(Ix::RequestAiOracle as u8);
    data.extend_from_slice(&(text.len() as u32).to_le_bytes());
    data.extend_from_slice(text.as_bytes());
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(feed, false),
            AccountMeta::new(ctx.payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn borsh_string(s: &str) -> Vec<u8> {
    let mut data = Vec::from(CALLBACK_DISCRIMINATOR);
    data.extend_from_slice(&(s.len() as u32).to_le_bytes());
    data.extend_from_slice(s.as_bytes());
    data
}

fn seed_identity(ctx: &mut TestCtx) {
    ctx.svm
        .set_account(
            identity_pda(),
            Account {
                lamports: 1_000_000,
                data: vec![0u8; 8],
                owner: gpt_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
}

fn callback_ix(
    ctx: &TestCtx,
    config: Pubkey,
    oracle: Pubkey,
    feed: Pubkey,
    response: &str,
) -> Instruction {
    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(identity_pda(), true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(feed, false),
        ],
        data: borsh_string(response),
    }
}

#[test]
fn set_config_request_callback_and_apply() {
    let mut ctx = TestCtx::new_unverified();
    let protocol = ctx.ensure_protocol();
    let (config, _) = config_pda(&ctx.program_id);
    let llm = llm_context();
    ctx.send(
        set_config_ix(&ctx, protocol, config, llm, 64, 1),
        &[],
    )
    .expect("set config");

    let cfg: AiOracleConfig = ctx.read_pod(config);
    assert_eq!(cfg.enabled, 1);
    assert_eq!(cfg.max_staleness_slots, 64);
    assert_eq!(cfg.llm_context, llm.to_bytes().into());
    assert_eq!(cfg.source, AI_ORACLE_SOURCE_MAGICBLOCK);

    let oracle = ctx.seed_disputed_oracle(&[
        ProposerSpec {
            option: 0,
            bond: 1_000,
        },
        ProposerSpec {
            option: 1,
            bond: 1_000,
        },
    ]);
    ctx.set_phase(oracle, Phase::AiClaim);

    let (feed, _) = feed_pda(&ctx.program_id, &oracle);
    ctx.send(request_ix(&ctx, config, oracle, feed, "resolve"), &[])
        .expect("request");
    let pending: AiOracleFeed = ctx.read_pod(feed);
    assert_eq!(pending.option, AiOracleFeed::OPTION_PENDING);
    assert_eq!(pending.oracle, oracle.to_bytes().into());

    seed_identity(&mut ctx);
    ctx.send_unverified(
        callback_ix(&ctx, config, oracle, feed, r#"{"option_index": 1}"#),
        &[],
    )
    .expect("callback");
    let f: AiOracleFeed = ctx.read_pod(feed);
    assert_eq!(f.option, 1);
    assert_eq!(f.model_id.as_ref(), GPT_ORACLE_PROGRAM_ID.as_ref());
    assert_eq!(f.params_hash, llm.to_bytes());
    assert_eq!(f.updated_by, identity_pda().to_bytes().into());

    let proposer_pda = ctx.proposers(oracle)[0].pda;
    let (claim, _) = claim_pda(&ctx.program_id, &oracle, &proposer_pda);
    let apply = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(proposer_pda, false),
            AccountMeta::new(claim, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(feed, false),
            AccountMeta::new(ctx.payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: vec![Ix::ApplyExternalAiClaim as u8],
    };
    ctx.send(apply, &[]).expect("apply");

    let c = ctx.ai_claim(claim);
    assert_eq!(c.option, 1);
    let p = ctx.proposer(proposer_pda);
    assert_eq!(p.claim_option, 1);
    assert_eq!(p.flipped, 1); // original option was 0
}

#[test]
fn apply_disabled_fails() {
    let mut ctx = TestCtx::new();
    let protocol = ctx.ensure_protocol();
    let (config, _) = config_pda(&ctx.program_id);
    ctx.send(
        set_config_ix(&ctx, protocol, config, llm_context(), 64, 0),
        &[],
    )
    .unwrap();

    let oracle = ctx.seed_disputed_oracle(&[ProposerSpec {
        option: 0,
        bond: 1_000,
    }]);
    ctx.set_phase(oracle, Phase::AiClaim);
    let (feed, _) = feed_pda(&ctx.program_id, &oracle);
    let proposer_pda = ctx.proposers(oracle)[0].pda;
    let (claim, _) = claim_pda(&ctx.program_id, &oracle, &proposer_pda);
    let apply = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(proposer_pda, false),
            AccountMeta::new(claim, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(feed, false),
            AccountMeta::new(ctx.payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: vec![Ix::ApplyExternalAiClaim as u8],
    };
    let err = ctx.send(apply, &[]).unwrap_err().err;
    assert_eq!(
        err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(KassandraError::AiOracleDisabled as u32),
        ),
    );
}

#[test]
fn callback_without_identity_signer_fails() {
    let mut ctx = TestCtx::new_unverified();
    let protocol = ctx.ensure_protocol();
    let (config, _) = config_pda(&ctx.program_id);
    ctx.send(
        set_config_ix(&ctx, protocol, config, llm_context(), 64, 1),
        &[],
    )
    .unwrap();
    let oracle = ctx.seed_disputed_oracle(&[ProposerSpec {
        option: 0,
        bond: 1_000,
    }]);
    let (feed, _) = feed_pda(&ctx.program_id, &oracle);
    ctx.send(request_ix(&ctx, config, oracle, feed, "q"), &[])
        .unwrap();
    seed_identity(&mut ctx);

    let mut ix = callback_ix(&ctx, config, oracle, feed, r#"{"option_index": 0}"#);
    ix.accounts[0].is_signer = false;
    let err = ctx.send(ix, &[]).unwrap_err().err;
    assert_eq!(
        err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(KassandraError::Unauthorized as u32),
        ),
    );
}

#[test]
fn callback_rejects_unparseable_response() {
    let mut ctx = TestCtx::new_unverified();
    let protocol = ctx.ensure_protocol();
    let (config, _) = config_pda(&ctx.program_id);
    ctx.send(
        set_config_ix(&ctx, protocol, config, llm_context(), 64, 1),
        &[],
    )
    .unwrap();
    let oracle = ctx.seed_disputed_oracle(&[ProposerSpec {
        option: 0,
        bond: 1_000,
    }]);
    let (feed, _) = feed_pda(&ctx.program_id, &oracle);
    ctx.send(request_ix(&ctx, config, oracle, feed, "q"), &[])
        .unwrap();
    seed_identity(&mut ctx);
    let err = ctx
        .send_unverified(callback_ix(&ctx, config, oracle, feed, "not a number"), &[])
        .unwrap_err()
        .err;
    assert_eq!(
        err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(KassandraError::InvalidAiOracleResponse as u32),
        ),
    );
}
