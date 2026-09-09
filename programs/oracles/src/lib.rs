#![allow(unexpected_cfgs)]
use pinocchio::{account::AccountView as AccountInfo, address::Address as Pubkey, ProgramResult};

// `entrypoint!` also installs the default allocator and panic handler.
// Gated so the crate can be reused as a plain library (CPI helpers,
// discriminators, etc.) without emitting a second program entrypoint.
#[cfg(not(feature = "no-entrypoint"))]
use pinocchio::entrypoint;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub mod clock;
pub mod config;
pub mod cpi;
pub mod error;
pub mod fee;
pub mod instruction;
pub mod plurality;
pub mod price;
pub mod processor;
pub mod rent;
pub mod reward;
pub mod stake_floor;
pub mod state;

pub const ID: Pubkey = Pubkey::from_str_const("KassVxvXUEPr5apSr2MqiGva4VFtJXyYLLDFS3f83nY");

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &mut [AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 8-byte discriminators (MagicBlock undelegate callback, GPT-oracle
    // callback) are not Kassandra `Ix` bytes. Intercept before 1-byte dispatch.
    if instruction_data.len() >= 8
        && instruction_data[..8] == crate::cpi::magicblock::EXTERNAL_UNDELEGATE_DISCRIMINATOR
    {
        return processor::undelegate_callback::process(program_id, accounts, &instruction_data[8..]);
    }
    if instruction_data.len() >= 8
        && instruction_data[..8] == crate::cpi::gpt_oracle::CALLBACK_DISCRIMINATOR
    {
        return processor::callback_from_gpt_oracle::process(
            program_id,
            accounts,
            &instruction_data[8..],
        );
    }
    processor::process(program_id, accounts, instruction_data)
}
