import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import globals from "globals";

export default [
    { ignores: ["interface/**", "node_modules/**"] },
    js.configs.recommended,
    ...vue.configs["flat/essential"],
    {
        files: ["main.js", "server/**/*.js", "network/**/*.js", "test/**/*.js"],
        languageOptions: { sourceType: "commonjs", globals: globals.node },
    },
    {
        files: ["*.mjs"],
        languageOptions: { sourceType: "module", globals: globals.node },
    },
    {
        files: ["source/**/*.js", "source/**/*.vue"],
        languageOptions: { sourceType: "module", globals: globals.browser },
        rules: {
            // the page's components keep their original one-word names
            "vue/multi-word-component-names": "off",
        },
    },
    {
        rules: {
            quotes: ["error", "double", { avoidEscape: true }],
            semi: ["error", "always"],
            "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
        },
    },
];
