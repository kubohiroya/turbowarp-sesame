// Name: TurboWarp-Sesame
// ID: kubohiroyasesame
// Description: Control and inspect Candy House Sesame devices from TurboWarp.
// By: Hiroya Kubo
// License: MPL-2.0

(function (Scratch) {
  'use strict';

  //#region src/config.ts
  var extensionConfig = {
  	id: "kubohiroyasesame",
  	slug: "turbowarp-sesame",
  	name: "TurboWarp-Sesame",
  	description: "Control and inspect Candy House Sesame devices from TurboWarp.",
  	author: "Hiroya Kubo",
  	license: "MPL-2.0",
  	unsandboxed: false,
  	docsURI: "https://kubohiroya.github.io/turbowarp-sesame/",
  	blockIconURI: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PHJlY3QgeD0iNSIgeT0iMyIgd2lkdGg9IjM4IiBoZWlnaHQ9IjQyIiByeD0iOCIgZmlsbD0iI2YyYjUyYiIvPjxjaXJjbGUgY3g9IjI0IiBjeT0iMTkiIHI9IjgiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSI0Ii8+PHBhdGggZD0iTTI0IDI3djEwIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9zdmc+"
  };
  //#endregion
  //#region config/feature-flags.ts
  /**
  * Safety-critical features are fixed when the extension bundle is built.
  * Keep remote lock control disabled in public/default builds.
  */
  var featureFlags = { sesameCommands: false };
  var block_definitions_default = {
  	extensionName: "TurboWarp-Sesame",
  	blocks: [
  		{
  			"opcode": "configure",
  			"blockType": "COMMAND",
  			"text": "configure Direct mode API key [API_KEY] UUID [UUID] secret key [SECRET_KEY]",
  			"description": "Selects Direct mode and keeps the Candy House credentials in memory until they are cleared or the extension reloads.",
  			"arguments": {
  				"API_KEY": {
  					"type": "STRING",
  					"defaultValue": "api-key"
  				},
  				"UUID": {
  					"type": "STRING",
  					"defaultValue": "00000000-0000-0000-0000-000000000000"
  				},
  				"SECRET_KEY": {
  					"type": "STRING",
  					"defaultValue": "00000000000000000000000000000000"
  				}
  			}
  		},
  		{
  			"opcode": "configureRelay",
  			"blockType": "COMMAND",
  			"text": "configure local Relay [ENDPOINT] device alias [DEVICE_ALIAS]",
  			"description": "Selects Relay mode for a localhost Capability Proxy without storing Candy House credentials in the project.",
  			"arguments": {
  				"ENDPOINT": {
  					"type": "STRING",
  					"defaultValue": "http://127.0.0.1:8787"
  				},
  				"DEVICE_ALIAS": {
  					"type": "STRING",
  					"defaultValue": "front-door"
  				}
  			}
  		},
  		{
  			"opcode": "pairRelay",
  			"blockType": "COMMAND",
  			"text": "pair local Relay with one-time code [CODE]",
  			"description": "Exchanges an eight-digit one-time code for a Relay token held only in extension memory.",
  			"arguments": { "CODE": {
  				"type": "STRING",
  				"defaultValue": "00000000"
  			} }
  		},
  		{
  			"opcode": "clearCredentials",
  			"blockType": "COMMAND",
  			"text": "clear Sesame connection",
  			"description": "Removes Direct credentials or the local Relay session held by the running extension.",
  			"arguments": {}
  		},
  		{
  			"opcode": "isConfigured",
  			"blockType": "BOOLEAN",
  			"text": "Sesame connection ready?",
  			"description": "Reports whether Direct credentials or a paired Relay session are currently held in memory.",
  			"arguments": {}
  		},
  		{
  			"opcode": "relayPaired",
  			"blockType": "BOOLEAN",
  			"text": "local Relay paired?",
  			"description": "Reports whether the current Relay connection has an in-memory session token.",
  			"arguments": {}
  		},
  		{
  			"opcode": "connectionMode",
  			"blockType": "REPORTER",
  			"text": "Sesame connection mode",
  			"description": "Reports direct, relay, or not configured.",
  			"arguments": {}
  		},
  		{
  			"opcode": "getStatusField",
  			"blockType": "REPORTER",
  			"text": "Sesame status [FIELD]",
  			"description": "Fetches one field from the current Sesame status.",
  			"arguments": { "FIELD": {
  				"type": "STRING",
  				"defaultValue": "CHSesame2Status",
  				"menu": "statusFields"
  			} }
  		},
  		{
  			"opcode": "getHistory",
  			"blockType": "REPORTER",
  			"text": "Sesame history page [PAGE] length [LENGTH]",
  			"description": "Fetches up to 50 history records as a JSON string.",
  			"arguments": {
  				"PAGE": {
  					"type": "NUMBER",
  					"defaultValue": 0
  				},
  				"LENGTH": {
  					"type": "NUMBER",
  					"defaultValue": 10
  				}
  			}
  		},
  		{
  			"opcode": "sendCommand",
  			"blockType": "COMMAND",
  			"text": "Sesame [COMMAND] with history [HISTORY]",
  			"description": "Requests a lock, unlock, or toggle operation when remote commands are enabled in the build.",
  			"arguments": {
  				"COMMAND": {
  					"type": "STRING",
  					"defaultValue": "lock",
  					"menu": "commands"
  				},
  				"HISTORY": {
  					"type": "STRING",
  					"defaultValue": "TurboWarp"
  				}
  			}
  		},
  		{
  			"opcode": "commandsEnabled",
  			"blockType": "BOOLEAN",
  			"text": "Sesame remote commands enabled?",
  			"description": "Reports the build-time safety flag for remote lock commands.",
  			"arguments": {}
  		},
  		{
  			"opcode": "lastError",
  			"blockType": "REPORTER",
  			"text": "last Sesame error",
  			"description": "Reports the most recent configuration or API error without exposing credentials.",
  			"arguments": {}
  		}
  	],
  	menus: {
  		"statusFields": {
  			"acceptReporters": true,
  			"items": [
  				"CHSesame2Status",
  				"batteryPercentage",
  				"batteryVoltage",
  				"position",
  				"timestamp",
  				"wm2State"
  			]
  		},
  		"commands": {
  			"acceptReporters": false,
  			"items": [
  				{
  					"text": "lock",
  					"value": "lock"
  				},
  				{
  					"text": "unlock",
  					"value": "unlock"
  				},
  				{
  					"text": "toggle",
  					"value": "toggle"
  				}
  			]
  		}
  	}
  };
  //#endregion
  //#region src/relay-client.ts
  var LOOPBACK_HOSTNAMES = /* @__PURE__ */ new Set([
  	"127.0.0.1",
  	"localhost",
  	"[::1]"
  ]);
  var ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;
  var TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/u;
  async function pairWithRelay(configuration, code, fetcher = fetch) {
  	const normalized = validateRelayConfiguration(configuration);
  	if (!/^\d{8}$/u.test(code)) throw new TypeError("Relay pairing code must contain exactly eight digits.");
  	const record = requireRecord$1(await requestJson(fetcher, `${normalized.endpoint}/v1/pair`, {
  		method: "POST",
  		headers: { "content-type": "application/json" },
  		body: JSON.stringify({ code }),
  		redirect: "error"
  	}), "Relay returned an invalid pairing response.");
  	if (!TOKEN_PATTERN.test(String(record.token ?? ""))) throw new Error("Relay returned an invalid pairing token.");
  	if (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) throw new Error("Relay returned an invalid session expiration.");
  	return {
  		...normalized,
  		token: String(record.token),
  		expiresAt: record.expiresAt
  	};
  }
  var BROKER_CAPABILITIES = /* @__PURE__ */ new Set(["history"]);
  var RelayClient = class {
  	constructor(session, fetcher = fetch) {
  		this.fetcher = fetcher;
  		const configuration = validateRelayConfiguration(session);
  		if (!TOKEN_PATTERN.test(session.token)) throw new TypeError("Relay token has an invalid format.");
  		if (!Number.isFinite(session.expiresAt)) throw new TypeError("Relay session expiration must be a number.");
  		this.session = {
  			...configuration,
  			token: session.token,
  			expiresAt: session.expiresAt
  		};
  	}
  	capabilities() {
  		return BROKER_CAPABILITIES;
  	}
  	async getStatus() {
  		return requireRecord$1(await this.request(this.devicePath("status")), "Relay returned an invalid status response.");
  	}
  	async getHistory(page, length) {
  		const parameters = new URLSearchParams({
  			page: String(page),
  			length: String(length)
  		});
  		const result = await this.request(`${this.devicePath("history")}?${parameters}`);
  		if (!Array.isArray(result)) throw new Error("Relay returned an invalid history response.");
  		return result;
  	}
  	async sendCommand(command, history) {
  		return this.request(this.devicePath(`commands/${command}`), {
  			method: "POST",
  			headers: { "content-type": "application/json" },
  			body: JSON.stringify({ history })
  		});
  	}
  	devicePath(suffix) {
  		return `/v1/candyhouse/devices/${encodeURIComponent(this.session.deviceAlias)}/${suffix}`;
  	}
  	async request(path, init = {}) {
  		if (this.session.expiresAt <= Date.now()) throw new Error("Relay session has expired. Pair with the local relay again.");
  		return requireRecord$1(await requestJson(this.fetcher, `${this.session.endpoint}${path}`, {
  			...init,
  			headers: {
  				...init.headers,
  				authorization: `Bearer ${this.session.token}`
  			},
  			redirect: "error"
  		}), "Relay returned an invalid response.").data;
  	}
  };
  function validateRelayConfiguration(configuration) {
  	let url;
  	try {
  		url = new URL(configuration.endpoint.trim());
  	} catch {
  		throw new TypeError("Relay endpoint must be a valid URL.");
  	}
  	if (url.protocol !== "http:" || !LOOPBACK_HOSTNAMES.has(url.hostname)) throw new TypeError("Relay endpoint must use HTTP on a loopback hostname.");
  	if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0 || url.pathname !== "/" && url.pathname !== "") throw new TypeError("Relay endpoint must contain only its loopback origin.");
  	const deviceAlias = configuration.deviceAlias.trim();
  	if (!ALIAS_PATTERN.test(deviceAlias)) throw new TypeError("Relay device alias has an invalid format.");
  	return {
  		endpoint: url.origin,
  		deviceAlias
  	};
  }
  async function requestJson(fetcher, url, init) {
  	const response = await fetcher(url, init);
  	const text = await response.text();
  	let result = null;
  	if (text.length > 0) try {
  		result = JSON.parse(text);
  	} catch {
  		throw new Error(`Relay returned a non-JSON response (${response.status}).`);
  	}
  	if (!response.ok) throw new Error(`Relay request failed (${response.status}): ${errorDetail$1(result)}`);
  	return result;
  }
  function requireRecord$1(value, message) {
  	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  	return value;
  }
  function errorDetail$1(value) {
  	if (typeof value === "object" && value !== null) {
  		const root = value;
  		if (typeof root.error === "object" && root.error !== null) {
  			const error = root.error;
  			if (typeof error.message === "string") return error.message;
  		}
  	}
  	return "unknown error";
  }
  //#endregion
  //#region src/aes-cmac.ts
  var BLOCK_SIZE = 16;
  var RB = 135;
  async function aesCmac(keyHex, message, subtle = crypto.subtle) {
  	const keyBytes = hexToBytes(keyHex);
  	if (keyBytes.length !== BLOCK_SIZE) throw new TypeError("Secret key must be exactly 32 hexadecimal characters.");
  	const key = await subtle.importKey("raw", toArrayBuffer(keyBytes), { name: "AES-CBC" }, false, ["encrypt"]);
  	const encryptBlock = async (block) => {
  		const encrypted = await subtle.encrypt({
  			name: "AES-CBC",
  			iv: new Uint8Array(BLOCK_SIZE)
  		}, key, toArrayBuffer(block));
  		return new Uint8Array(encrypted).slice(0, BLOCK_SIZE);
  	};
  	const zero = new Uint8Array(BLOCK_SIZE);
  	const firstSubkey = doubleBlock(await encryptBlock(zero));
  	const secondSubkey = doubleBlock(firstSubkey);
  	const blockCount = Math.max(1, Math.ceil(message.length / BLOCK_SIZE));
  	const completeLastBlock = message.length > 0 && message.length % BLOCK_SIZE === 0;
  	let state = zero;
  	for (let index = 0; index < blockCount - 1; index += 1) {
  		const block = message.slice(index * BLOCK_SIZE, (index + 1) * BLOCK_SIZE);
  		state = await encryptBlock(xor(state, block));
  	}
  	const lastStart = (blockCount - 1) * BLOCK_SIZE;
  	const finalBlock = completeLastBlock ? xor(message.slice(lastStart, lastStart + BLOCK_SIZE), firstSubkey) : xor(pad(message.slice(lastStart)), secondSubkey);
  	return bytesToHex(await encryptBlock(xor(state, finalBlock)));
  }
  function sesameTimestampMessage(timestampSeconds) {
  	if (!Number.isInteger(timestampSeconds) || timestampSeconds < 0 || timestampSeconds > 4294967295) throw new RangeError("Timestamp must be an unsigned 32-bit integer.");
  	return new Uint8Array([
  		timestampSeconds >>> 8 & 255,
  		timestampSeconds >>> 16 & 255,
  		timestampSeconds >>> 24 & 255
  	]);
  }
  function doubleBlock(block) {
  	const output = new Uint8Array(BLOCK_SIZE);
  	let carry = 0;
  	for (let index = 15; index >= 0; index -= 1) {
  		const value = block[index] ?? 0;
  		output[index] = value << 1 & 255 | carry;
  		carry = (value & 128) === 0 ? 0 : 1;
  	}
  	if (carry !== 0) output[15] = (output[15] ?? 0) ^ RB;
  	return output;
  }
  function pad(block) {
  	const output = new Uint8Array(BLOCK_SIZE);
  	output.set(block);
  	output[block.length] = 128;
  	return output;
  }
  function xor(left, right) {
  	const output = new Uint8Array(BLOCK_SIZE);
  	for (let index = 0; index < BLOCK_SIZE; index += 1) output[index] = (left[index] ?? 0) ^ (right[index] ?? 0);
  	return output;
  }
  function hexToBytes(value) {
  	if (!/^[0-9a-f]+$/iu.test(value) || value.length % 2 !== 0) throw new TypeError("Secret key must contain only hexadecimal characters.");
  	return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
  }
  function bytesToHex(value) {
  	return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function toArrayBuffer(value) {
  	return value.slice().buffer;
  }
  //#endregion
  //#region src/sesame-client.ts
  var API_BASE_URL = "https://app.candyhouse.co/api/sesame2";
  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  var COMMAND_CODES = {
  	lock: 82,
  	unlock: 83,
  	toggle: 88
  };
  var CLOUD_CAPABILITIES = /* @__PURE__ */ new Set(["history"]);
  var SesameClient = class {
  	constructor(credentials, fetcher = fetch, now = Date.now) {
  		this.credentials = credentials;
  		this.fetcher = fetcher;
  		this.now = now;
  		validateCredentials(credentials);
  	}
  	capabilities() {
  		return CLOUD_CAPABILITIES;
  	}
  	async getStatus() {
  		return requireRecord(await this.request(this.deviceUrl()));
  	}
  	async getHistory(page, length) {
  		const parameters = new URLSearchParams({
  			page: String(page),
  			lg: String(length)
  		});
  		const result = await this.request(`${this.deviceUrl()}/history?${parameters}`);
  		if (!Array.isArray(result)) throw new Error("Candy House returned an invalid history response.");
  		return result;
  	}
  	async sendCommand(command, history) {
  		const timestampSeconds = Math.floor(this.now() / 1e3);
  		const sign = await aesCmac(this.credentials.secretKey, sesameTimestampMessage(timestampSeconds));
  		return this.request(`${this.deviceUrl()}/cmd`, {
  			method: "POST",
  			headers: { "content-type": "application/json" },
  			body: JSON.stringify({
  				cmd: COMMAND_CODES[command],
  				history: encodeBase64(history),
  				sign
  			})
  		});
  	}
  	deviceUrl() {
  		return `${API_BASE_URL}/${encodeURIComponent(this.credentials.uuid)}`;
  	}
  	async request(url, init = {}) {
  		const response = await this.fetcher(url, {
  			...init,
  			headers: {
  				...init.headers,
  				"x-api-key": this.credentials.apiKey
  			}
  		});
  		const result = parseResponse(await response.text());
  		if (!response.ok) throw new Error(`Candy House API request failed (${response.status}): ${errorDetail(result)}`);
  		return result;
  	}
  };
  function validateCredentials(credentials) {
  	if (credentials.apiKey.trim().length === 0) throw new TypeError("API key must not be empty.");
  	if (!UUID_PATTERN.test(credentials.uuid)) throw new TypeError("Sesame UUID must use the canonical UUID format.");
  	if (!/^[0-9a-f]{32}$/iu.test(credentials.secretKey)) throw new TypeError("Secret key must be exactly 32 hexadecimal characters.");
  }
  function parseResponse(body) {
  	if (body.length === 0) return null;
  	try {
  		return JSON.parse(body);
  	} catch {
  		return body;
  	}
  }
  function requireRecord(value) {
  	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Candy House returned an invalid status response.");
  	return value;
  }
  function errorDetail(value) {
  	if (typeof value === "string") return value;
  	if (typeof value === "object" && value !== null) {
  		const record = value;
  		const message = record.message ?? record.Message;
  		if (typeof message === "string") return message;
  	}
  	return "unknown error";
  }
  function encodeBase64(value) {
  	const bytes = new TextEncoder().encode(value);
  	let binary = "";
  	for (const byte of bytes) binary += String.fromCharCode(byte);
  	return btoa(binary);
  }
  //#endregion
  //#region src/transport.ts
  function supports(transport, capability) {
  	return transport.capabilities().has(capability);
  }
  function requireCapability(transport, capability, explanation) {
  	if (!supports(transport, capability)) throw new Error(explanation);
  }
  //#endregion
  //#region src/extension.ts
  var blockDefinitions = block_definitions_default.blocks;
  var menuDefinitions = block_definitions_default.menus;
  var SesameExtension = class {
  	constructor() {
  		this.lastErrorMessage = "";
  	}
  	getInfo() {
  		return {
  			id: extensionConfig.id,
  			name: Scratch.translate(block_definitions_default.extensionName),
  			docsURI: extensionConfig.docsURI,
  			blockIconURI: extensionConfig.blockIconURI,
  			color1: "#e8a51b",
  			color2: "#ce8d0e",
  			color3: "#ad7408",
  			blocks: blockDefinitions.map((block) => this.toScratchBlock(block)),
  			menus: menuDefinitions
  		};
  	}
  	configure(args) {
  		this.capture(() => {
  			const credentials = {
  				apiKey: Scratch.Cast.toString(args.API_KEY).trim(),
  				uuid: Scratch.Cast.toString(args.UUID).trim().toUpperCase(),
  				secretKey: Scratch.Cast.toString(args.SECRET_KEY).trim().toLowerCase()
  			};
  			new SesameClient(credentials);
  			this.connection = {
  				mode: "direct",
  				credentials
  			};
  		});
  	}
  	configureRelay(args) {
  		this.capture(() => {
  			requireUnsandboxedRelay();
  			const configuration = validateRelayConfiguration({
  				endpoint: Scratch.Cast.toString(args.ENDPOINT),
  				deviceAlias: Scratch.Cast.toString(args.DEVICE_ALIAS)
  			});
  			this.connection = {
  				mode: "relay",
  				configuration
  			};
  		});
  	}
  	async pairRelay(args) {
  		await this.captureAsync(async () => {
  			if (this.connection?.mode !== "relay") throw new Error("Configure the local relay first.");
  			const session = await pairWithRelay(this.connection.configuration, Scratch.Cast.toString(args.CODE).trim());
  			this.connection = {
  				mode: "relay",
  				configuration: this.connection.configuration,
  				session
  			};
  		}, void 0);
  	}
  	clearCredentials() {
  		this.connection = void 0;
  		this.lastErrorMessage = "";
  	}
  	isConfigured() {
  		return this.connection?.mode === "direct" || this.relayPaired();
  	}
  	relayPaired() {
  		return this.connection?.mode === "relay" && this.connection.session !== void 0 && this.connection.session.expiresAt > Date.now();
  	}
  	connectionMode() {
  		return this.connection?.mode ?? "not configured";
  	}
  	commandsEnabled() {
  		return featureFlags.sesameCommands;
  	}
  	async getStatusField(args) {
  		return this.captureAsync(async () => {
  			const value = (await this.transport().getStatus())[Scratch.Cast.toString(args.FIELD)];
  			return isScratchValue(value) ? value : value === void 0 ? "" : JSON.stringify(value);
  		}, "");
  	}
  	async getHistory(args) {
  		return this.captureAsync(async () => {
  			const page = boundedInteger(Scratch.Cast.toNumber(args.PAGE), 0, Number.MAX_SAFE_INTEGER);
  			const length = boundedInteger(Scratch.Cast.toNumber(args.LENGTH), 1, 50);
  			const transport = this.transport();
  			requireCapability(transport, "history", "This connection cannot read paginated history.");
  			const getHistory = transport.getHistory?.bind(transport);
  			if (getHistory === void 0) throw new Error("This connection cannot read paginated history.");
  			return JSON.stringify(await getHistory(page, length));
  		}, "[]");
  	}
  	async sendCommand(args) {
  		await this.captureAsync(async () => {
  			if (!featureFlags.sesameCommands) throw new Error("Remote lock commands are disabled in this build.");
  			const command = Scratch.Cast.toString(args.COMMAND);
  			if (!isSesameCommand(command)) throw new TypeError(`Unknown Sesame command: ${command}`);
  			await this.transport().sendCommand(command, Scratch.Cast.toString(args.HISTORY));
  		}, void 0);
  	}
  	lastError() {
  		return this.lastErrorMessage;
  	}
  	transport() {
  		if (this.connection?.mode === "direct") return new SesameClient(this.connection.credentials);
  		if (this.connection?.mode === "relay" && this.connection.session !== void 0) return new RelayClient(this.connection.session);
  		if (this.connection?.mode === "relay") throw new Error("Pair with the local relay first.");
  		throw new Error("Configure Direct mode or the local relay first.");
  	}
  	capture(action) {
  		try {
  			action();
  			this.lastErrorMessage = "";
  		} catch (error) {
  			this.lastErrorMessage = normalizeError(error);
  		}
  	}
  	async captureAsync(action, fallback) {
  		try {
  			const result = await action();
  			this.lastErrorMessage = "";
  			return result;
  		} catch (error) {
  			this.lastErrorMessage = normalizeError(error);
  			return fallback;
  		}
  	}
  	toScratchBlock(block) {
  		return {
  			opcode: block.opcode,
  			blockType: Scratch.BlockType[block.blockType],
  			text: Scratch.translate(block.text),
  			arguments: Object.fromEntries(Object.entries(block.arguments ?? {}).map(([name, argument]) => [name, {
  				type: Scratch.ArgumentType[argument.type],
  				defaultValue: argument.defaultValue,
  				...argument.menu === void 0 ? {} : { menu: argument.menu }
  			}]))
  		};
  	}
  };
  function requireUnsandboxedRelay() {
  	if (!Scratch.extensions.unsandboxed) throw new Error("Relay mode requires reloading this custom extension with \"Run extension without sandbox\" enabled so the browser can access localhost.");
  }
  function isSesameCommand(value) {
  	return value === "lock" || value === "unlock" || value === "toggle";
  }
  function isScratchValue(value) {
  	return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }
  function boundedInteger(value, minimum, maximum) {
  	if (!Number.isFinite(value)) return minimum;
  	return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
  }
  function normalizeError(error) {
  	return error instanceof Error ? error.message : String(error);
  }
  //#endregion
  //#region src/index.ts
  if (extensionConfig.unsandboxed && !Scratch.extensions.unsandboxed) throw new Error(`${extensionConfig.name} must run unsandboxed.`);
  Scratch.extensions.register(new SesameExtension());
  //#endregion

})(Scratch);
