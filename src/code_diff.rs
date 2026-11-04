//! The official DiffView with native Unicode widths and single-line code rows.
use nsh_base::{DiffLayout, DiffView, DiffViewApi, DiffViewClasses, diff_view};
use nsh_core::prelude::*;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, PartialEq, Props)]
pub struct CodeDiffProps {
    /// The selected file's Git patch.
    pub patch: Prop<SharedString>,
    /// The same font used for drawing and measuring the code.
    pub font_family: Prop<SharedString>,
    /// Font size in points.
    #[prop(default = 12.0)]
    pub font_size: Prop<f32>,
    /// One logical code row in points.
    #[prop(default = 18.0)]
    pub line_height: Prop<f32>,
    /// Side-by-side or unified review.
    #[prop(default = DiffLayout::Unified)]
    pub layout: Prop<DiffLayout>,
}

pub struct CodeDiffApi {
    view: ComponentRef<DiffView>,
}

#[methods]
impl CodeDiffApi {
    /// Scroll to the selected change.
    pub fn go_to_hunk(&self, index: u32) {
        if let Some(view) = self.view.api::<DiffViewApi>() {
            view.go_to_hunk(index);
        }
    }

    /// Scroll to the next change and return its index.
    pub fn next_hunk(&self) -> Option<u32> {
        self.view
            .api::<DiffViewApi>()
            .and_then(|view| view.next_hunk())
    }

    /// Scroll to the previous change and return its index.
    pub fn previous_hunk(&self) -> Option<u32> {
        self.view
            .api::<DiffViewApi>()
            .and_then(|view| view.previous_hunk())
    }
}

/// Official NSH DiffView, keeping CJK glyphs from wrapping into neighboring rows.
#[component(methods = CodeDiffApi)]
pub fn CodeDiff(props: CodeDiffProps, cx: Scope<NoEvent>) -> impl IntoElement {
    let reference = component_ref::<DiffView>();
    cx.methods(CodeDiffApi { view: reference });
    let widths = Arc::new(Mutex::new(WidthCache::default()));
    let classes = computed(move || {
        let font = format!("{}px {}", props.font_size.get(), props.font_family.get());
        let width = widths
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .patch_width(&props.patch.get(), &font);
        let mut classes = DiffViewClasses::default();
        classes.content = Some(format!("whitespace-nowrap min-w-[{}px]", width + 24.0).into());
        classes.line_added = Some("bg-diff-added".into());
        classes.line_deleted = Some("bg-diff-removed".into());
        classes.word_added = Some("bg-diff-added-word".into());
        classes.word_deleted = Some("bg-diff-removed-word".into());
        classes.line_number_added = Some("text-success".into());
        classes.line_number_deleted = Some("text-destructive".into());
        classes.indicator_added = Some("text-success".into());
        classes.indicator_deleted = Some("text-destructive".into());
        classes.separator = Some("bg-surface-muted text-muted-foreground".into());
        classes.filler = Some("bg-muted/20".into());
        classes
    });
    diff_view()
        .component_ref(&reference)
        .patch(move || Some(props.patch.get()))
        .layout(move || props.layout.get())
        .font_family(move || Some(props.font_family.get()))
        .font_size(move || props.font_size.get())
        .line_height(move || props.line_height.get())
        .soft_wrap(false)
        .classes(move || classes.get())
}

#[derive(Default)]
struct WidthCache {
    font: String,
    monospace: bool,
    cell_width: f32,
    lines: VecDeque<(String, f32)>,
    bytes: usize,
}

impl WidthCache {
    fn patch_width(&mut self, patch: &str, font: &str) -> f32 {
        if self.font != font {
            self.font = font.to_owned();
            self.lines.clear();
            self.bytes = 0;
            self.cell_width = measure_text(font, "0000000000").0 / 10.0;
            self.monospace =
                (measure_text(font, "iiii").0 - measure_text(font, "WWWW").0).abs() < 0.01;
        }
        let mut in_hunk = false;
        let mut width = 0.0_f32;
        for line in patch.lines() {
            if line.starts_with("diff --git ") {
                in_hunk = false;
            }
            if line.starts_with("@@") {
                in_hunk = true;
                continue;
            }
            if !in_hunk || !matches!(line.as_bytes().first(), Some(b' ' | b'+' | b'-')) {
                continue;
            }
            let text = &line[1..];
            if self.monospace && text.is_ascii() {
                let columns = text.bytes().fold(0usize, |column, byte| {
                    column + if byte == b'\t' { 4 - column % 4 } else { 1 }
                });
                width = width.max(columns as f32 * self.cell_width);
                continue;
            }
            if let Some(index) = self.lines.iter().position(|(key, _)| key == text) {
                let entry = self.lines.remove(index).expect("cached code width");
                width = width.max(entry.1);
                self.lines.push_back(entry);
                continue;
            }
            // Unicode and proportional fonts keep exact native shaping; tabs match the view.
            let mut column = 0;
            let mut expanded = String::new();
            for character in text.chars() {
                if character == '\t' {
                    let spaces = 4 - column % 4;
                    expanded.extend(std::iter::repeat_n(' ', spaces));
                    column += spaces;
                } else {
                    expanded.push(character);
                    column += 1;
                }
            }
            let measured = measure_text(font, &expanded).0;
            width = width.max(measured);
            if text.len() <= 16 * 1024 {
                self.bytes += text.len();
                self.lines.push_back((text.to_owned(), measured));
                while self.lines.len() > 256 || self.bytes > 256 * 1024 {
                    if let Some((key, _)) = self.lines.pop_front() {
                        self.bytes -= key.len();
                    }
                }
            }
        }
        width
    }
}
