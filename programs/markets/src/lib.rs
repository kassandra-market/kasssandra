#![allow(unexpected_cfgs)]
use pinocchio::{account::AccountView, address::Address, ProgramResult};

#[cfg(not(feature = "no-entrypoint"))]
use pinocchio::entrypoint;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub mod config;
pub mod cpi;
pub mod error;
pub mod instruction;
pub mod liquidity_floor;
pub mod processor;
pub mod state;

pub const ID: Address = Address::from_str_const("FEGNHWAB7kc7VC9CCwbvVPsv4Jykz2r2WQ758V4xCT9S");

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() >= 8
        && instruction_data[..8] == crate::cpi::gpt_oracle::CALLBACK_DISCRIMINATOR
    {
        return processor::callback_from_gpt::process(
            program_id,
            accounts,
            &instruction_data[8..],
        );
    }
    processor::process(program_id, accounts, instruction_data)
}
