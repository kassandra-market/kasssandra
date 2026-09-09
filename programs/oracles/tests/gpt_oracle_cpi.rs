//! Load the tracked MagicBlock `solana-gpt-oracle` ELF (test identity) into
//! LiteSVM and drive the real wire: `initialize` → `create_llm_context` →
//! Kassandra `RequestAiOracle` CPI `interact_with_llm` → GPT `callback_from_llm`
//! (signed by the public test keypair) → `ApplyExternalAiClaim`.
//!
//! The fixture is a source-built ELF at SHA `96f1143f…` with `ORACLE_IDENTITY`
//! patched to `tEsT3eV6…` — see `scripts/vendor-solana-gpt-oracle.sh`. It is
//! loaded only here, not into every [`TestCtx`].

mod common;
use common::*;

use kassandra_oracles_program::{
    cpi::gpt_oracle::{CALLBACK_FROM_LLM, CREATE_LLM_CONTEXT, GPT_ORACLE_PROGRAM_ID, INITIALIZE},
    state::{AiOracleFeed, Phase, AI_ORACLE_SOURCE_MAGICBLOCK},
};
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_sdk_ids::system_program;
use solana_signer::Signer;

const GPT_SO: &[u8] = include_bytes!("fixtures/solana_gpt_oracle.so");

/// MagicBlock public test oracle keypair (64-byte secret). Pubkey
/// `tEsT3eV6RFCWs1BZ7AXTzasHqTtMnMLCB2tjQ42TDXD`.
const TEST_IDENTITY_SECRET: [u8; 64] = [
    251, 62, 129, 184, 107, 49, 62, 184, 1, 147, 178, 128, 185, 157, 247, 92, 56, 158, 145, 53, 51,
    226, 202, 96, 178, 248, 195, 133, 133, 237, 237, 146, 13, 32, 77, 204, 244, 56, 166, 172, 66,
    113, 150, 218, 112, 42, 110, 181, 98, 158, 222, 194, 130, 93, 175, 100, 190, 106, 9, 69, 156,
    80, 96, 72,
];

fn gpt_id() -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(GPT_ORACLE_PROGRAM_ID.as_ref());
    Pubkey::new_from_array(b)
}

fn test_identity() -> Keypair {
    Keypair::try_from(&TEST_IDENTITY_SECRET[..]).expect("test identity secret")
}

fn borsh_string_ix(disc: [u8; 8], text: &str) -> Vec<u8> {
    let mut data = Vec::from(disc);
    data.extend_from_slice(&(text.len() as u32).to_le_bytes());
    data.extend_from_slice(text.as_bytes());
    data
}

fn send_ok(ctx: &mut TestCtx, ixs: &[Instruction], signers: &[&Keypair]) {
    let mut all = vec![ComputeBudgetInstruction::set_compute_unit_limit(600_000)];
    all.extend_from_slice(ixs);
    ctx.send_many(&all, signers)
        .unwrap_or_else(|e| panic!("tx failed: {:?}\nlogs:\n{}", e.err, e.meta.logs.join("\n")));
}

#[test]
fn gpt_elf_initialize_interact_callback_apply() {
    let mut ctx = TestCtx::new();
    ctx.svm.add_program(gpt_id(), GPT_SO).unwrap();

    let identity_kp = test_identity();
    assert_eq!(
        identity_kp.pubkey(),
        solana_pubkey::pubkey!("tEsT3eV6RFCWs1BZ7AXTzasHqTtMnMLCB2tjQ42TDXD")
    );
    ctx.svm
        .airdrop(&identity_kp.pubkey(), 2_000_000_000)
        .unwrap();

    let gpt = gpt_id();
    let payer = ctx.payer.pubkey();
    let program_id = ctx.program_id;
    let identity_pda = kassandra_oracles_sdk::pda::gpt_oracle_identity().0;
    let counter = kassandra_oracles_sdk::pda::gpt_oracle_counter().0;
    let llm_context = kassandra_oracles_sdk::pda::gpt_oracle_context(0).0;

    send_ok(
        &mut ctx,
        &[Instruction {
            program_id: gpt,
            accounts: vec![
                AccountMeta::new(payer, true),
                AccountMeta::new(identity_pda, false),
                AccountMeta::new(counter, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: INITIALIZE.to_vec(),
        }],
        &[],
    );

    const CONTEXT_TEXT: &str = "Reply with JSON {\"option_index\": N}.";
    send_ok(
        &mut ctx,
        &[Instruction {
            program_id: gpt,
            accounts: vec![
                AccountMeta::new(payer, true),
                AccountMeta::new(counter, false),
                AccountMeta::new(llm_context, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: borsh_string_ix(CREATE_LLM_CONTEXT, CONTEXT_TEXT),
        }],
        &[],
    );

    let protocol = ctx.ensure_protocol();
    let (config, _) = kassandra_oracles_sdk::pda::ai_oracle_config(&program_id);
    send_ok(
        &mut ctx,
        &[kassandra_oracles_sdk::ix::set_ai_oracle_config(
            &program_id,
            protocol,
            config,
            payer,
            llm_context,
            10_000,
            AI_ORACLE_SOURCE_MAGICBLOCK,
            true,
        )],
        &[],
    );

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

    let (feed, _) = kassandra_oracles_sdk::pda::ai_oracle_feed(&program_id, &oracle);
    let interaction = kassandra_oracles_sdk::pda::gpt_oracle_interaction(&payer, &llm_context).0;
    send_ok(
        &mut ctx,
        &[kassandra_oracles_sdk::ix::request_ai_oracle_with_gpt(
            &program_id,
            config,
            oracle,
            feed,
            payer,
            b"resolve",
            interaction,
            llm_context,
        )],
        &[],
    );

    let pending: AiOracleFeed = ctx.read_pod(feed);
    assert_eq!(pending.option, AiOracleFeed::OPTION_PENDING);

    const RESPONSE: &str = r#"{"option_index": 1}"#;
    let identity_pk = identity_kp.pubkey();
    send_ok(
        &mut ctx,
        &[Instruction {
            program_id: gpt,
            accounts: vec![
                AccountMeta::new(identity_pk, true),
                AccountMeta::new_readonly(identity_pda, false),
                AccountMeta::new(interaction, false),
                AccountMeta::new_readonly(program_id, false),
                AccountMeta::new_readonly(config, false),
                AccountMeta::new_readonly(oracle, false),
                AccountMeta::new(feed, false),
            ],
            data: borsh_string_ix(CALLBACK_FROM_LLM, RESPONSE),
        }],
        &[&identity_kp],
    );

    let f: AiOracleFeed = ctx.read_pod(feed);
    assert_eq!(f.option, 1);
    assert_eq!(f.updated_by, identity_pda.to_bytes().into());

    let proposer_pda = ctx.proposers(oracle)[0].pda;
    let (claim, _) = kassandra_oracles_sdk::pda::ai_claim(&program_id, &oracle, &proposer_pda);
    send_ok(
        &mut ctx,
        &[kassandra_oracles_sdk::ix::apply_external_ai_claim(
            &program_id,
            oracle,
            proposer_pda,
            claim,
            config,
            feed,
            payer,
        )],
        &[],
    );
    let c = ctx.ai_claim(claim);
    assert_eq!(c.option, 1);
}
