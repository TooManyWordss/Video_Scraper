/** word-extractor ships without types; this covers the part the importer uses. */
declare module 'word-extractor' {
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<{ getBody(): string }>;
  }
}
