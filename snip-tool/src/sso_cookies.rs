// sso-cookies subcommand (US-1581): Windows single sign-on proof for Microsoft
// work and school accounts.
//
// Asks Windows (IProofOfPossessionCookieInfoManager, the API Chrome and Firefox
// use for the same purpose) for the proof-of-possession cookies of one sign-in
// URI and prints them as one JSON line:
//
//   {"cookies":[{"name":"x-ms-RefreshTokenCredential","data":"..."}]}
//
// Any failure (API missing, device not joined, no account) prints an empty list
// and still exits 0. The values are credentials: nothing is ever written to
// stderr, and the caller must not log stdout.

use windows_sys::core::{GUID, HRESULT, PCWSTR, PWSTR};
use windows_sys::Win32::Networking::WinInet::{
    ProofOfPossessionCookieInfo, ProofOfPossessionCookieInfoManager,
};
use windows_sys::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_MULTITHREADED,
};

use crate::clipboard::json_escape;

/// IID_IProofOfPossessionCookieInfoManager (ProofOfPossessionCookieInfo.h).
/// windows-sys declares the interface only as an opaque pointer, so its vtable
/// is declared here.
const IID_MANAGER: GUID = GUID::from_u128(0xcdaece56_4edf_43df_b113_88e4556fa1bb);

#[repr(C)]
struct ManagerVtbl {
    query_interface: usize,
    add_ref: usize,
    release: unsafe extern "system" fn(this: *mut Manager) -> u32,
    get_cookie_info_for_uri: unsafe extern "system" fn(
        this: *mut Manager,
        uri: PCWSTR,
        count: *mut u32,
        cookies: *mut *mut ProofOfPossessionCookieInfo,
    ) -> HRESULT,
}

#[repr(C)]
struct Manager {
    vtbl: *const ManagerVtbl,
}

pub fn run(uri: Option<String>) {
    let cookies = match uri {
        Some(uri) if !uri.is_empty() => unsafe { get_cookies(&uri) },
        _ => Vec::new(),
    };
    let mut json = String::from("{\"cookies\":[");
    for (i, (name, data)) in cookies.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str("{\"name\":\"");
        json.push_str(&json_escape(name));
        json.push_str("\",\"data\":\"");
        json.push_str(&json_escape(data));
        json.push_str("\"}");
    }
    json.push_str("]}");
    println!("{}", json);
    std::process::exit(0);
}

unsafe fn get_cookies(uri: &str) -> Vec<(String, String)> {
    let initialized = CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32) >= 0;
    let cookies = if initialized { query_manager(uri) } else { Vec::new() };
    if initialized {
        CoUninitialize();
    }
    cookies
}

unsafe fn query_manager(uri: &str) -> Vec<(String, String)> {
    let mut manager: *mut Manager = std::ptr::null_mut();
    let created = CoCreateInstance(
        &ProofOfPossessionCookieInfoManager,
        std::ptr::null_mut(),
        CLSCTX_INPROC_SERVER,
        &IID_MANAGER,
        &mut manager as *mut *mut Manager as *mut *mut core::ffi::c_void,
    );
    if created < 0 || manager.is_null() {
        return Vec::new();
    }

    let wide: Vec<u16> = uri.encode_utf16().chain(std::iter::once(0)).collect();
    let mut count: u32 = 0;
    let mut info: *mut ProofOfPossessionCookieInfo = std::ptr::null_mut();
    let vtbl = &*(*manager).vtbl;
    let hr = (vtbl.get_cookie_info_for_uri)(manager, wide.as_ptr(), &mut count, &mut info);

    let mut cookies = Vec::new();
    if hr >= 0 && !info.is_null() {
        for i in 0..count as usize {
            let item = &*info.add(i);
            let name = from_wide(item.name);
            let data = from_wide(item.data);
            if !name.is_empty() {
                cookies.push((name, data));
            }
        }
    }
    if !info.is_null() {
        free_cookie_info_array(info, count);
    }
    (vtbl.release)(manager);
    cookies
}

/// FreeProofOfPossessionCookieInfoArray is an __inline helper in the SDK header
/// (no DLL export), so its body is reproduced here.
unsafe fn free_cookie_info_array(info: *mut ProofOfPossessionCookieInfo, count: u32) {
    for i in 0..count as usize {
        let item = &*info.add(i);
        CoTaskMemFree(item.name as *const core::ffi::c_void);
        CoTaskMemFree(item.data as *const core::ffi::c_void);
        CoTaskMemFree(item.p3pHeader as *const core::ffi::c_void);
    }
    CoTaskMemFree(info as *const core::ffi::c_void);
}

unsafe fn from_wide(ptr: PWSTR) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}
