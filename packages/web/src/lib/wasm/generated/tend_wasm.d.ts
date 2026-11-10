/* tslint:disable */
/* eslint-disable */

export function apply_block_updates(page_json: string, blocks_json: string, expected_version?: bigint | null): string;

export function apply_property_updates(page_json: string, properties_json: string): string;

export function decode_filename(encoded: string): string;

export function decrypt_scrypt(encrypted: Uint8Array, passphrase: string): string;

export function decrypt_with_identity(encrypted: Uint8Array, identity: string): string;

export function encode_filename(name: string): string;

export function encrypt_scrypt(content: string, passphrase: string): Uint8Array;

export function encrypt_to_recipient(content: string, recipient: string): Uint8Array;

export function extract_links(page_json: string): string;

export function extract_tags(page_json: string): string;

export function extract_tasks(page_json: string, content_type_json: string, date?: string | null): string;

export function generate_identity(): string;

export function identity_to_recipient(identity: string): string;

export function instantiate_template(template_json: string, target_json: string): string;

export function parse_markdown(content: string, name: string): string;

export function qualify_name(content_type_json: string, bare_name: string, date?: string | null): string;

export function serialize_page(page_json: string): string;

export function sheet_meta(content_type_json: string, bare_name: string, date: string | null | undefined, block_count: number, created_at_ms: bigint, modified_at_ms: bigint): string;

export function sheet_ref(content_type_json: string, rel_dirs_json: string, filename: string, encrypted: boolean): string;

export function sheet_ref_meta(content_type_json: string, bare_name: string, date?: string | null): string;

export function sheet_rel_path(content_type_json: string, name: string, date: string | null | undefined, encrypted: boolean, encode: boolean): string;

export function sort_sheets(sheets_json: string, content_type_json: string): string;

export function split_name(content_type_json: string, canonical: string): string;

export function strip_cursor_marker(content: string, track: boolean): string;

export function unwrap_identity(wrapped: Uint8Array, passphrase: string): string;

export function validate_safe_name(name: string): void;

export function wrap_identity(identity: string, passphrase: string): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly apply_block_updates: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => void;
    readonly apply_property_updates: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decode_filename: (a: number, b: number, c: number) => void;
    readonly decrypt_scrypt: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decrypt_with_identity: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encode_filename: (a: number, b: number, c: number) => void;
    readonly encrypt_scrypt: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_to_recipient: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly extract_links: (a: number, b: number, c: number) => void;
    readonly extract_tags: (a: number, b: number, c: number) => void;
    readonly extract_tasks: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly generate_identity: (a: number) => void;
    readonly identity_to_recipient: (a: number, b: number, c: number) => void;
    readonly instantiate_template: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly parse_markdown: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly qualify_name: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly serialize_page: (a: number, b: number, c: number) => void;
    readonly sheet_meta: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint, j: bigint) => void;
    readonly sheet_ref: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly sheet_ref_meta: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly sheet_rel_path: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly sort_sheets: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly split_name: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly strip_cursor_marker: (a: number, b: number, c: number, d: number) => void;
    readonly unwrap_identity: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly validate_safe_name: (a: number, b: number, c: number) => void;
    readonly wrap_identity: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
