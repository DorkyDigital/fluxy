/// str.length counts the number of UTF-16 code units in the string, not the number of
/// Unicode characters, so emojis may be counted as more than 1 character.
/// We must convert it into an array of Unicode characters to get the character count
export default function strLen(str: string): number {
  return [...str].length;
}
