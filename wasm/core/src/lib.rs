//! Strikegy's CPU kernels, compiled to `wasm32-unknown-unknown` with SIMD128.
//!
//! No allocator and no wasm-bindgen: every buffer is a fixed static array in
//! linear memory, so the memory never grows and the JS side keeps typed-array
//! views on it (`src/wasm/core.ts`). JS writes the inputs into those views,
//! calls an export with a few numbers, and reads the outputs back.

#![no_std]

pub mod crowd;
pub mod hitboxes;
pub mod occluders;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
