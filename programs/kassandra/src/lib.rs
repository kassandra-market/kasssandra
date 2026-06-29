#![allow(unexpected_cfgs)]
use pinocchio::{
    account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey,
    ProgramResult,
};

// `entrypoint!` also installs the default allocator and panic handler.
entrypoint!(process_instruction);

pub const ID: Pubkey = pinocchio_pubkey::pubkey!("KassVxvXUEPr5apSr2MqiGva4VFtJXyYLLDFS3f83nY");

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(())
}
