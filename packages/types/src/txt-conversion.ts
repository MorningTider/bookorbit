export interface TxtConversionRequest {
  encoding?: "auto" | "utf8" | "gb18030" | "utf16le" | "utf16be";
  chapters?: "auto" | "chinese" | "english" | "single";
}
