//! GPT callback writes [`Subject.resolved_option`] (sigverify off; identity PDA
//! marked as signer without the production key).

mod common;
use common::*;

use kassandra_markets_program::{
    cpi::gpt_oracle::{CALLBACK_DISCRIMINATOR, GPT_ORACLE_PROGRAM_ID, IDENTITY_SEED},
    state::{Subject, SubjectStatus, SUBJECT_OPTION_PENDING},
};
use kassandra_markets_sdk::ix;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signer::Signer,
};

fn borsh_string(s: &str) -> Vec<u8> {
    let mut data = Vec::from(CALLBACK_DISCRIMINATOR);
    data.extend_from_slice(&(s.len() as u32).to_le_bytes());
    data.extend_from_slice(s.as_bytes());
    data
}

#[test]
fn create_subject_then_gpt_callback_stamps_option() {
    let mut ctx = TestCtx::new_no_sigverify();
    let llm_context = Pubkey::new_unique();
    let nonce = 7u64;
    let ix = ix::create_subject(&ctx.payer.pubkey(), nonce, 2, &llm_context);
    assert!(ctx.send(ix, &[]).is_ok());

    let (subject, _) = kassandra_markets_sdk::pda::subject(nonce);
    let acc = ctx.svm.get_account(&subject).expect("subject");
    let s: Subject = *bytemuck::from_bytes(&acc.data[..Subject::LEN]);
    assert_eq!(s.options_count, 2);
    assert_eq!(s.status, SubjectStatus::Open.as_u8());
    assert_eq!(s.resolved_option, SUBJECT_OPTION_PENDING);

    let gpt_id = Pubkey::new_from_array(GPT_ORACLE_PROGRAM_ID.to_bytes());
    let identity = Pubkey::find_program_address(&[IDENTITY_SEED], &gpt_id).0;
    ctx.svm.airdrop(&identity, 1_000_000_000).unwrap();

    let cb = Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(identity, true),
            AccountMeta::new(subject, false),
        ],
        data: borsh_string(r#"{"option_index": 1}"#),
    };
    let res = ctx.send_payer_only(cb);
    assert!(res.is_ok(), "{res:?}");

    let acc = ctx.svm.get_account(&subject).expect("subject");
    let s: Subject = *bytemuck::from_bytes(&acc.data[..Subject::LEN]);
    assert_eq!(s.status, SubjectStatus::Resolved.as_u8());
    assert_eq!(s.resolved_option, 1);
}
