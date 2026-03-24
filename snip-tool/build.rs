fn main() {
    let mut res = winres::WindowsResource::new();
    res.set_icon("../assets/icon.ico");
    res.set("ProductName", "JS-Notepad");
    res.set("FileDescription", "JS-Notepad Screen Snip");
    res.set("CompanyName", "js-notepad");
    res.set("LegalCopyright", "MIT License");
    res.compile().expect("Failed to compile Windows resources");
}
