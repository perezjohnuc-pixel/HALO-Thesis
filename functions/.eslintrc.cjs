module.exports = {
  root: true,
  env: { es2020: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { project: ["./tsconfig.json"], tsconfigRootDir: __dirname },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off"
  }
};
