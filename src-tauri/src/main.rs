// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Arguments mean the command line (`jottr help`). Old macOS versions pass `-psn_…` to apps
    // opened from Finder, which isn't one.
    let args: Vec<String> = std::env::args().skip(1).filter(|arg| !arg.starts_with("-psn_")).collect();
    if !args.is_empty() {
        std::process::exit(jottr_lib::cli(args));
    }
    jottr_lib::run()
}
