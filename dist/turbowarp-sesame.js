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
  			"text": "configure API key [API_KEY] UUID [UUID] secret key [SECRET_KEY]",
  			"description": "Keeps the Candy House credentials in memory until they are cleared or the extension reloads.",
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
  			"opcode": "clearCredentials",
  			"blockType": "COMMAND",
  			"text": "clear Sesame credentials",
  			"description": "Removes all Candy House credentials held by the running extension.",
  			"arguments": {}
  		},
  		{
  			"opcode": "isConfigured",
  			"blockType": "BOOLEAN",
  			"text": "Sesame credentials configured?",
  			"description": "Reports whether valid credentials are currently held in memory.",
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
  var SesameClient = class {
  	constructor(credentials, fetcher = fetch, now = Date.now) {
  		this.credentials = credentials;
  		this.fetcher = fetcher;
  		this.now = now;
  		validateCredentials(credentials);
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
  			this.credentials = credentials;
  		});
  	}
  	clearCredentials() {
  		this.credentials = void 0;
  		this.lastErrorMessage = "";
  	}
  	isConfigured() {
  		return this.credentials !== void 0;
  	}
  	commandsEnabled() {
  		return featureFlags.sesameCommands;
  	}
  	async getStatusField(args) {
  		return this.captureAsync(async () => {
  			const value = (await this.client().getStatus())[Scratch.Cast.toString(args.FIELD)];
  			return isScratchValue(value) ? value : value === void 0 ? "" : JSON.stringify(value);
  		}, "");
  	}
  	async getHistory(args) {
  		return this.captureAsync(async () => {
  			const page = boundedInteger(Scratch.Cast.toNumber(args.PAGE), 0, Number.MAX_SAFE_INTEGER);
  			const length = boundedInteger(Scratch.Cast.toNumber(args.LENGTH), 1, 50);
  			return JSON.stringify(await this.client().getHistory(page, length));
  		}, "[]");
  	}
  	async sendCommand(args) {
  		await this.captureAsync(async () => {
  			if (!featureFlags.sesameCommands) throw new Error("Remote lock commands are disabled in this build.");
  			const command = Scratch.Cast.toString(args.COMMAND);
  			if (!isSesameCommand(command)) throw new TypeError(`Unknown Sesame command: ${command}`);
  			await this.client().sendCommand(command, Scratch.Cast.toString(args.HISTORY));
  		}, void 0);
  	}
  	lastError() {
  		return this.lastErrorMessage;
  	}
  	client() {
  		if (this.credentials === void 0) throw new Error("Configure Sesame credentials first.");
  		return new SesameClient(this.credentials);
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
