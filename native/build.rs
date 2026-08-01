fn main() {
    println!("cargo:rerun-if-changed=cpp/include/mev_kernel.h");
    println!("cargo:rerun-if-changed=cpp/src/mev_kernel.cpp");
    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .include("cpp/include")
        .file("cpp/src/mev_kernel.cpp")
        .warnings(true)
        .compile("mev_kernel");
}
