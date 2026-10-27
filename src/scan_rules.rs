//! Generated dependency, environment and build trees; source directories remain traversable.
use std::{ffi::OsStr, path::Path};

pub(super) fn generated(name: &OsStr, parent: &Path) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    if matches!(
        name,
        "node_modules"
            | "bower_components"
            | "jspm_packages"
            | ".pnpm"
            | ".pnpm-store"
            | ".npm"
            | ".yarn"
            | ".next"
            | ".nuxt"
            | ".output"
            | ".turbo"
            | ".parcel-cache"
            | ".vite"
            | ".svelte-kit"
            | ".angular"
            | ".astro"
            | ".docusaurus"
            | ".nx"
            | ".webpack"
            | ".rollup.cache"
            | ".vercel"
            | ".netlify"
            | ".serverless"
            | ".cache"
            | "cache"
            | "caches"
            | "coverage"
            | ".nyc_output"
            | ".nsh"
            | "__pycache__"
            | ".venv"
            | "venv"
            | ".tox"
            | ".nox"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".ruff_cache"
            | ".hypothesis"
            | ".ipynb_checkpoints"
            | ".eggs"
            | "site-packages"
            | "target"
            | ".gradle"
            | ".kotlin"
            | ".cxx"
            | ".externalNativeBuild"
            | ".build"
            | "DerivedData"
            | "Pods"
            | "Carthage"
            | ".dart_tool"
            | ".pub-cache"
            | ".fvm"
            | ".nuget"
            | "CMakeFiles"
            | "_deps"
            | ".zig-cache"
            | "zig-cache"
            | "zig-out"
            | ".stack-work"
            | "dist-newstyle"
            | "_build"
            | ".bundle"
            | "blib"
            | "_Inline"
            | ".vs"
    ) || name.starts_with("cmake-build-")
        || name.ends_with(".egg-info")
    {
        return true;
    }
    let has = |file: &str| parent.join(file).is_file();
    match name {
        "build" | "dist" | "out" => [
            "package.json",
            "pyproject.toml",
            "setup.py",
            "Cargo.toml",
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "CMakeLists.txt",
            "meson.build",
            "pubspec.yaml",
            "Package.swift",
            "mix.exs",
        ]
        .iter()
        .any(|file| has(file)),
        "vendor" => has("go.mod") || has("Gopkg.toml") || has("composer.json") || has("Gemfile"),
        "deps" => has("mix.exs"),
        "env" => parent.join("env/pyvenv.cfg").is_file(),
        "bin" | "obj" => std::fs::read_dir(parent).ok().is_some_and(|entries| {
            entries.flatten().any(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                [".csproj", ".fsproj", ".vbproj", ".sln"]
                    .iter()
                    .any(|extension| name.ends_with(extension))
            })
        }),
        "library" | "staging" => parent.file_name().is_some_and(|name| name == "renv"),
        _ => false,
    }
}
