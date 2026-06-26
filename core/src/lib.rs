//! NES 模拟器的 WebAssembly 包装层。
//!
//! 核心模拟逻辑来自 `takahirox/nes-rust`,这里只做 JS <-> WASM 的桥接:
//! - 加载 ROM、启动、复位
//! - 逐帧推进(`step_frame`)
//! - 把一帧像素拷进 JS 传入的缓冲区(`update_pixels`)
//! - 把音频采样拷进 JS 传入的缓冲区(`update_sample_buffer`)
//! - 按键的按下/抬起

use nes_rust::button;
use nes_rust::default_audio::DefaultAudio;
use nes_rust::default_display::DefaultDisplay;
use nes_rust::default_input::DefaultInput;
use nes_rust::rom::Rom;
use nes_rust::Nes;
use wasm_bindgen::prelude::*;

/// 屏幕宽高与缓冲区尺寸,供 JS 侧分配缓冲区时参照。
/// (wasm_bindgen 不支持直接导出常量,这里用函数 getter 暴露。)
#[wasm_bindgen]
pub fn screen_width() -> u32 {
    256
}
#[wasm_bindgen]
pub fn screen_height() -> u32 {
    240
}
/// 像素缓冲区长度:256 * 240 * 4(RGBA)。
#[wasm_bindgen]
pub fn pixels_len() -> u32 {
    256 * 240 * 4
}
/// 音频采样缓冲区长度(与核心库约定一致)。
#[wasm_bindgen]
pub fn audio_buffer_len() -> u32 {
    4096
}

/// 暴露给 JS 的按键枚举,变体名与核心库一一对应。
#[wasm_bindgen]
#[derive(Copy, Clone)]
pub enum Button {
    Poweroff,
    Reset,
    Select,
    Start,
    Joypad1A,
    Joypad1B,
    Joypad1Up,
    Joypad1Down,
    Joypad1Left,
    Joypad1Right,
    Joypad2A,
    Joypad2B,
    Joypad2Up,
    Joypad2Down,
    Joypad2Left,
    Joypad2Right,
}

fn to_button_internal(b: Button) -> button::Button {
    match b {
        Button::Poweroff => button::Button::Poweroff,
        Button::Reset => button::Button::Reset,
        Button::Select => button::Button::Select,
        Button::Start => button::Button::Start,
        Button::Joypad1A => button::Button::Joypad1A,
        Button::Joypad1B => button::Button::Joypad1B,
        Button::Joypad1Up => button::Button::Joypad1Up,
        Button::Joypad1Down => button::Button::Joypad1Down,
        Button::Joypad1Left => button::Button::Joypad1Left,
        Button::Joypad1Right => button::Button::Joypad1Right,
        Button::Joypad2A => button::Button::Joypad2A,
        Button::Joypad2B => button::Button::Joypad2B,
        Button::Joypad2Up => button::Button::Joypad2Up,
        Button::Joypad2Down => button::Button::Joypad2Down,
        Button::Joypad2Left => button::Button::Joypad2Left,
        Button::Joypad2Right => button::Button::Joypad2Right,
    }
}

/// JS 与 WASM NES 模拟器之间的接口。
#[wasm_bindgen]
pub struct WasmNes {
    nes: Nes,
}

#[wasm_bindgen]
impl WasmNes {
    /// 创建一个使用默认输入/显示/音频后端的实例。
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let input = Box::new(DefaultInput::new());
        let display = Box::new(DefaultDisplay::new());
        let audio = Box::new(DefaultAudio::new());
        let nes = Nes::new(input, display, audio);
        WasmNes { nes }
    }

    /// 载入 ROM(`.nes` 文件的原始字节)。
    pub fn set_rom(&mut self, contents: Vec<u8>) {
        self.nes.set_rom(Rom::new(contents));
    }

    /// 上电启动。
    pub fn bootup(&mut self) {
        self.nes.bootup();
    }

    /// 复位。
    pub fn reset(&mut self) {
        self.nes.reset();
    }

    /// 推进一帧。
    pub fn step_frame(&mut self) {
        self.nes.step_frame();
    }

    /// 把当前帧像素拷入 `pixels`(长度需为 PIXELS_LEN,RGBA)。
    pub fn update_pixels(&self, pixels: &mut [u8]) {
        self.nes.copy_pixels(pixels);
    }

    /// 把音频采样拷入 `buffer`(长度需为 AUDIO_BUFFER_LEN,f32)。
    pub fn update_sample_buffer(&mut self, buffer: &mut [f32]) {
        self.nes.copy_sample_buffer(buffer);
    }

    /// 按下按键。
    pub fn press_button(&mut self, button: Button) {
        self.nes.press_button(to_button_internal(button));
    }

    /// 抬起按键。
    pub fn release_button(&mut self, button: Button) {
        self.nes.release_button(to_button_internal(button));
    }
}

impl Default for WasmNes {
    fn default() -> Self {
        Self::new()
    }
}
