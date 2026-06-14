// `import text from "./file.md" with { type: "text" }` - Bun loads the file as a string.
declare module "*.md" {
  const content: string;
  export default content;
}
