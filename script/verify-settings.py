#!/usr/bin/env python3
"""Check complete catalogs and appearance/language persistence in an isolated app host."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from nsh_toolchain import nsh_command

PROJECT = Path(__file__).resolve().parent.parent
STEPS = r'''
import { expect, open, test } from "nsh/test";
import { MESSAGE_KEYS, translate } from "../../i18n";
import { LANGUAGES, languageForLocale, PREFERENCES_STORAGE_KEY } from "../../preferences";

const names = {zh:"设置",en:"Settings",ja:"設定",ko:"설정",fr:"Paramètres",de:"Einstellungen",es:"Ajustes",pt:"Configurações"};
const lightColors = {blue:"#336b94ff",teal:"#276f70ff",green:"#3b744fff",rose:"#995168ff",amber:"#8a651fff"};
function placeholders(text) { return (text.match(/\{\w+\}/g)||[]).sort(); }
function saved(app) { return JSON.parse(app.storage()[PREFERENCES_STORAGE_KEY]); }
async function settled(app, key, value) {
  await app.waitUntil(()=>saved(app)[key]===value && app.enabled("id:close-settings"));
}
async function chooseLanguage(app, value) {
  await app.press("id:choose-language");
  await app.waitFor("id:language-"+value);
  await app.press("id:language-"+value);
  await settled(app,"language",value);
  await app.waitFor("text:"+names[value]);
}
function color(app, expected) {
  if (NATIVE) return;
  const data=saved(app);
  const labels={blue:"Blue",teal:"Teal",green:"Green",rose:"Rose",amber:"Amber"};
  const label=translate(data.language,labels[data.accent||"blue"]);
  expect(app.spanStyle("text:"+label).color).toBe(expected);
}

for (const lang of LANGUAGES) test("catalog coverage and placeholders: "+lang,()=>{
  expect(translate(lang,"Settings")).toBe(names[lang]);
  for (const key of MESSAGE_KEYS) {
    const value=translate(lang,key);
    if (typeof value!=="string" || !value.trim()) throw new Error("Empty translation: "+lang+" / "+key);
    if (JSON.stringify(placeholders(value))!==JSON.stringify(placeholders(key))) throw new Error("Changed placeholders: "+lang+" / "+key);
    const formatted=translate(lang,key,{id:"abc1234",path:"src/file.txt",name:"fixture",count:2,total:3,changed:1,size:42,error:"fixture",field:"Author"});
    if (/\{\w+\}/.test(formatted)) throw new Error("Unformatted placeholder: "+lang+" / "+key);
  }
});
test("system locales choose a supported language",()=>{
  for (const [value,expected] of [["zh-Hans-CN","zh"],["ja-JP","ja"],["ko_KR","ko"],["fr-FR","fr"],["de-DE","de"],["es-ES","es"],["pt-BR","pt"],["it-IT","en"]]) expect(languageForLocale(value)).toBe(expected);
});

test("legacy settings migrate and all choices survive language changes and restart",async()=>{
  const storage = {[PREFERENCES_STORAGE_KEY]:JSON.stringify({language:"en"})};
  let app=await open(ENTRY,{platform:"macos",locale:"en-US",colorScheme:"light",width:1100,height:800,storage});
  try {
    await app.waitUntil(()=>app.enabled("id:open-settings"));
    await app.press("id:open-settings");
    await app.waitFor("id:current-accent");
    color(app,lightColors.blue);
    await app.press("id:appearance-dark");
    await settled(app,"appearance","dark");
    color(app,"#77a7c7ff");
    await app.setColorScheme("light");
    color(app,"#77a7c7ff");
    await app.press("id:appearance-light");
    await settled(app,"appearance","light");
    await app.setColorScheme("dark");
    color(app,lightColors.blue);
    await app.press("id:appearance-system");
    await settled(app,"appearance","system");
    color(app,"#77a7c7ff");
    await app.setColorScheme("light");
    color(app,lightColors.blue);
    for (const accent of ["teal","green","rose","amber","blue"]) {
      await app.press("id:accent-"+accent);
      await settled(app,"accent",accent);
      color(app,lightColors[accent]);
    }
    await app.press("id:accent-rose");
    await settled(app,"accent","rose");
    for (const lang of LANGUAGES) {
      await chooseLanguage(app,lang);
      expect(saved(app).accent).toBe("rose");
      expect(saved(app).appearance).toBe("system");
    }
    await chooseLanguage(app,"de");
    await app.press("id:appearance-dark");
    await settled(app,"appearance","dark");
    if (NATIVE) await app.screenshot(DARK_IMAGE);
    const persisted={...app.storage()};
    app.dispose();
    app=await open(ENTRY,{platform:"macos",locale:"en-US",colorScheme:"light",width:1100,height:800,storage:persisted});
    await app.waitUntil(()=>app.enabled("id:open-settings"));
    await app.press("id:open-settings");
    await app.waitFor("text:Einstellungen");
    expect(saved(app)).toEqual({language:"de",appearance:"dark",accent:"rose"});
    color(app,"#cf92a4ff");
    await app.press("id:appearance-light");
    await settled(app,"appearance","light");
    color(app,lightColors.rose);
    if (NATIVE) await app.screenshot(LIGHT_IMAGE);
    expect(app.shows("DiffLens encountered an error")).toBe(false);
  } finally {app.dispose();}
},120000);
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["macos"])
    args = parser.parse_args()
    output = PROJECT / ".nsh/verification"
    output.mkdir(parents=True, exist_ok=True)
    test = output / "settings.test.ts"
    replacements = {
        "ENTRY": json.dumps(str(PROJECT / "App.tsx")), "NATIVE": "true" if args.target else "false",
        "DARK_IMAGE": json.dumps(str(output / "settings-dark-de.png")),
        "LIGHT_IMAGE": json.dumps(str(output / "settings-light-de.png")),
    }
    code = STEPS
    for name in sorted(replacements, key=len, reverse=True):
        code = code.replace(name, replacements[name])
    test.write_text(code)
    command = [nsh_command(), "test", str(test)]
    if args.target:
        command += ["--target", args.target]
    try:
        subprocess.run(command, cwd=PROJECT, env=dict(os.environ, RUSTUP_TOOLCHAIN="stable", CARGO_NET_OFFLINE="true"), check=True)
    finally:
        test.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
