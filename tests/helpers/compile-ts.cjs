const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function compile(relative, overrides = {}) {
  const filename = path.resolve(__dirname, "../..", relative);
  const compiled = new Module(filename, module);
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = compiled.require.bind(compiled);
  compiled.require = (id) => {
    if (id in overrides) return overrides[id];
    if (id.startsWith("@/")) return compile(`${id.slice(2)}.ts`, overrides);
    if (id.startsWith(".") && fs.existsSync(path.resolve(path.dirname(filename), `${id}.ts`))) return compile(path.resolve(path.dirname(filename), `${id}.ts`), overrides);
    return original(id);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return compiled.exports;
}

module.exports = { compile };
