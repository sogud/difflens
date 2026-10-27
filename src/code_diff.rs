//! The official DiffView with native Unicode widths and single-line code rows.
use nsh_base::{DiffLayout, DiffViewClasses, diff_view};
use nsh_core::ui::prelude::*;

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
}

/// Official NSH DiffView, keeping CJK glyphs from wrapping into neighboring rows.
#[component]
pub fn CodeDiff(props: CodeDiffProps) -> impl IntoElement {
    let classes = computed(move || {
        let font = format!("{}px {}", props.font_size.get(), props.font_family.get());
        let width = patch_width(&props.patch.get(), &font);
        let mut classes = DiffViewClasses::default();
        classes.content = Some(format!("whitespace-nowrap min-w-[{}px]", width + 24.0).into());
        classes
    });
    diff_view()
        .patch(move || Some(props.patch.get()))
        .layout(DiffLayout::Unified)
        .font_family(move || Some(props.font_family.get()))
        .font_size(move || props.font_size.get())
        .line_height(move || props.line_height.get())
        .soft_wrap(false)
        .classes(move || classes.get())
}

fn patch_width(patch: &str, font: &str) -> f32 {
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
        if in_hunk && matches!(line.as_bytes().first(), Some(b' ' | b'+' | b'-')) {
            let mut column = 0;
            let mut text = String::new();
            for character in line[1..].chars() {
                if character == '\t' {
                    let spaces = 4 - column % 4;
                    text.extend(std::iter::repeat_n(' ', spaces));
                    column += spaces;
                } else {
                    text.push(character);
                    column += 1;
                }
            }
            width = width.max(measure_text(font, &text).0);
        }
    }
    width
}
