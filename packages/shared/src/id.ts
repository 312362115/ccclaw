import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 21;

export const nanoid = customAlphabet(ALPHABET, ID_LENGTH);

const SLUG_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SLUG_LENGTH = 10;

export const slugId = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);
