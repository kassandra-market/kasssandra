//! External AI oracle: `set_ai_oracle_config` / `push_ai_oracle_feed` /
//! `apply_external_ai_claim`.

mod common;
use common::*;

use kassandra_oracles_program::{
    error::KassandraError,
    instruction::Ix,
    state::{AiOracleConfig, AiOracleFeed, Phase, AI_ORACLE_SOURCE_EXTERNAL},
};
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

fn set_config_ix(
    ctx: &TestCtx,
    protocol: Pubkey,
    config: Pubkey,
    authority: Pubkey,
    max_staleness_slots: u64,
    enabled: u8,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 42);
    data.push(Ix::SetAiOracleConfig as u8);
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(&max_staleness_slots.to_le_bytes());
    data.push(AI_ORACLE_SOURCE_EXTERNAL);
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

fn push_payload(option: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(1 + 161);
    data.push(Ix::PushAiOracleFeed as u8);
    data.push(option);
    data.extend_from_slice(&[0x11; 32]);
    data.extend_from_slice(&[0x22; 32]);
    data.extend_from_slice(&[0x33; 32]);
    data.extend_from_slice(&[0x44; 64]);
    data
}

#[test]
fn set_config_push_and_apply() {
    let mut ctx = TestCtx::new();
    let protocol = ctx.ensure_protocol();
    let (config, _) = config_pda(&ctx.program_id);
    ctx.send(
        set_config_ix(
            &ctx,
            protocol,
            config,
            ctx.payer.pubkey(),
            64,
            1,
        ),
        &[],
    )
    .expect("set config");

    let cfg: AiOracleConfig = ctx.read_pod(config);
    assert_eq!(cfg.enabled, 1);
    assert_eq!(cfg.max_staleness_slots, 64);
    assert_eq!(cfg.authority, ctx.payer.pubkey().to_bytes().into());

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
    let push = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(feed, false),
            AccountMeta::new(ctx.payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: push_payload(1),
    };
    ctx.send(push, &[]).expect("push feed");
    let f: AiOracleFeed = ctx.read_pod(feed);
    assert_eq!(f.option, 1);
    assert_eq!(f.model_id, [0x11; 32]);
    assert_eq!(f.oracle, oracle.to_bytes().into());

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
    assert_eq!(c.model_id, [0x11; 32]);
    assert_eq!(c.params_hash, [0x22; 32]);
    assert_eq!(c.io_hash, [0x33; 32]);
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
        set_config_ix(&ctx, protocol, config, ctx.payer.pubkey(), 64, 0),
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
fn push_wrong_authority_fails() {
    let mut ctx = TestCtx::new();
    let protocol = ctx.ensure_protocol();
    let (config, _) = config_pda(&ctx.program_id);
    ctx.send(
        set_config_ix(&ctx, protocol, config, ctx.payer.pubkey(), 64, 1),
        &[],
    )
    .unwrap();

    let attacker = solana_keypair::Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    let oracle = ctx.seed_disputed_oracle(&[ProposerSpec {
        option: 0,
        bond: 1_000,
    }]);
    let (feed, _) = feed_pda(&ctx.program_id, &oracle);
    let push = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(oracle, false),
            AccountMeta::new(feed, false),
            AccountMeta::new(attacker.pubkey(), true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: push_payload(0),
    };
    let err = ctx.send(push, &[&attacker]).unwrap_err().err;
    assert_eq!(
        err,
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(KassandraError::Unauthorized as u32),
        ),
    );
}
