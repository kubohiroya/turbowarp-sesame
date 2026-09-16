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
  			"description": "Selects Relay mode for a localhost keybroker without storing Candy House credentials in the project.",
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
  			"opcode": "configureBluetooth",
  			"blockType": "COMMAND",
  			"text": "configure Bluetooth keyholder [KEYHOLDER_URL] device alias [DEVICE_ALIAS]",
  			"description": "Selects Bluetooth mode. The keyholder page holds the device secret on its own origin, so no credential is stored in the project.",
  			"arguments": {
  				"KEYHOLDER_URL": {
  					"type": "STRING",
  					"defaultValue": "https://kubohiroya.github.io/turbowarp-sesame/keyholder/"
  				},
  				"DEVICE_ALIAS": {
  					"type": "STRING",
  					"defaultValue": "front-door"
  				}
  			}
  		},
  		{
  			"opcode": "pairBluetooth",
  			"blockType": "COMMAND",
  			"text": "pair Sesame by scanning its sharing QR code",
  			"description": "Opens the keyholder so it can scan an owner or manager sharing QR code from the sesame app. Guest codes cannot work over Bluetooth.",
  			"arguments": {}
  		},
  		{
  			"opcode": "connectBluetooth",
  			"blockType": "COMMAND",
  			"text": "connect to Sesame over Bluetooth",
  			"description": "Opens the browser's device chooser and logs in. Run this straight after a click, because the chooser needs a recent user gesture.",
  			"arguments": {}
  		},
  		{
  			"opcode": "bluetoothConnected",
  			"blockType": "BOOLEAN",
  			"text": "Sesame Bluetooth connected?",
  			"description": "Reports whether a Bluetooth session is logged in and usable.",
  			"arguments": {}
  		},
  		{
  			"opcode": "whenStateChanges",
  			"blockType": "HAT",
  			"text": "when the Sesame state changes",
  			"description": "Runs when the lock reports that it moved. Only Bluetooth reports this; the cloud modes cannot.",
  			"arguments": {}
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
  //#region src/aes-cmac.ts
  var BLOCK_SIZE = 16;
  var RB = 135;
  async function aesCmac(keyHex, message, subtle = crypto.subtle) {
  	const keyBytes = hexToBytes(keyHex);
  	if (keyBytes.length !== BLOCK_SIZE) throw new TypeError("Secret key must be exactly 32 hexadecimal characters.");
  	return bytesToHex(await aesCmacWithKey(await importCmacKey(keyBytes, subtle), message, subtle));
  }
  /** Imports key material for {@link aesCmacWithKey}, without making it readable. */
  async function importCmacKey(raw, subtle = crypto.subtle) {
  	if (raw.length !== BLOCK_SIZE) throw new TypeError("AES-CMAC key must be exactly sixteen bytes.");
  	return subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-CBC" }, false, ["encrypt"]);
  }
  /**
  * AES-CMAC over a key the caller already holds.
  *
  * The key may be non-extractable: CMAC needs only single-block encryption, and
  * the subkeys are derived from ciphertext rather than from the key material.
  * This is what lets the device secret stay unreadable for its whole lifetime.
  */
  async function aesCmacWithKey(key, message, subtle = crypto.subtle) {
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
  	return encryptBlock(xor(state, finalBlock));
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
  //#region src/ble/protocol.ts
  /** BLE service registered by CANDY HOUSE with the Bluetooth SIG. */
  var SERVICE_UUID = 64897;
  /** Written without response to send requests. */
  var TX_CHARACTERISTIC_UUID = "16860002-a5ae-9856-b6d3-dbb4c676993e";
  /** Notified to deliver responses and publishes. */
  var RX_CHARACTERISTIC_UUID = "16860003-a5ae-9856-b6d3-dbb4c676993e";
  var ItemCode = {
  	registration: 1,
  	login: 2,
  	history: 4,
  	versionDetail: 5,
  	time: 8,
  	autolock: 11,
  	initial: 14,
  	magnet: 17,
  	mechSetting: 80,
  	mechStatus: 81,
  	lock: 82,
  	unlock: 83,
  	reset: 104
  };
  var OpCode = {
  	/** Acknowledgement of a request. */
  	response: 7,
  	/** Unsolicited message from the device. */
  	publish: 8
  };
  var ResultCode = {
  	success: 0,
  	invalidAction: 9
  };
  /**
  * The Bluetooth protocol has no toggle item code; the Web API's `toggle` (88)
  * has no counterpart here. A Bluetooth transport implements it by reading
  * {@link MechStatus.isInLockRange} and sending lock or unlock accordingly.
  */
  var COMMAND_ITEM_CODES = {
  	lock: ItemCode.lock,
  	unlock: ItemCode.unlock
  };
  /**
  * Builds a request body for the security layer: an item code followed by its
  * payload. The segment layer adds the packet header afterwards.
  */
  function encodeRequest(itemCode, payload = /* @__PURE__ */ new Uint8Array()) {
  	const message = new Uint8Array(payload.length + 1);
  	message[0] = itemCode;
  	message.set(payload, 1);
  	return message;
  }
  /**
  * Parses a reassembled message from the device.
  *
  * A response carries `type, item_code, result, payload...`; a publish carries
  * `type, item_code, payload...` with no result byte.
  */
  function decodeMessage(data) {
  	const type = data[0];
  	const itemCode = data[1];
  	if (type === void 0 || itemCode === void 0) throw new Error("Sesame BLE message is shorter than its header.");
  	if (type === OpCode.publish) return {
  		type,
  		itemCode,
  		payload: data.slice(2)
  	};
  	if (type !== OpCode.response) throw new Error(`Unknown Sesame BLE message type: ${type}.`);
  	const result = data[2];
  	if (result === void 0) throw new Error("Sesame BLE response is missing its result byte.");
  	return {
  		type,
  		itemCode,
  		result,
  		payload: data.slice(3)
  	};
  }
  /**
  * Decodes the seven-byte mechanical status payload of item code 81.
  *
  * Layout: `battery` uint16, `target` int16, `position` int16, all little
  * endian, then one byte of flags.
  */
  function decodeMechStatus(payload) {
  	if (payload.length < 7) throw new Error(`Sesame mechanical status needs seven bytes, received ${payload.length}.`);
  	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  	const flags = view.getUint8(6);
  	return {
  		battery: view.getUint16(0, true),
  		target: view.getInt16(2, true),
  		position: view.getInt16(4, true),
  		isClutchFailed: (flags & 1) !== 0,
  		isInLockRange: (flags & 2) !== 0,
  		isInUnlockRange: (flags & 4) !== 0,
  		isCritical: (flags & 8) !== 0,
  		isStop: (flags & 16) !== 0,
  		isLowBattery: (flags & 32) !== 0,
  		isClockwise: (flags & 64) !== 0
  	};
  }
  /**
  * Converts the raw battery reading of a SesameOS3 lock into volts.
  *
  * SesameOS3 reports millivolts per cell and these locks use two cells in
  * series, so the reading is scaled by two.
  */
  function batteryVoltage(battery) {
  	return battery * 2 / 1e3;
  }
  /**
  * Voltage to remaining percentage, linearly interpolated between the reference
  * points published for these locks.
  */
  var BATTERY_TABLE = [
  	[5.85, 100],
  	[5.82, 95],
  	[5.79, 90],
  	[5.76, 85],
  	[5.73, 80],
  	[5.7, 70],
  	[5.65, 60],
  	[5.6, 50],
  	[5.55, 40],
  	[5.5, 32],
  	[5.4, 21],
  	[5.2, 13],
  	[5.1, 10],
  	[5, 7],
  	[4.8, 3],
  	[4.6, 0]
  ];
  function batteryPercentage(voltage) {
  	const first = BATTERY_TABLE[0];
  	const last = BATTERY_TABLE[BATTERY_TABLE.length - 1];
  	if (first === void 0 || last === void 0) return 0;
  	if (voltage >= first[0]) return first[1];
  	if (voltage <= last[0]) return last[1];
  	for (let index = 1; index < BATTERY_TABLE.length; index += 1) {
  		const lower = BATTERY_TABLE[index];
  		const upper = BATTERY_TABLE[index - 1];
  		if (lower === void 0 || upper === void 0) break;
  		if (voltage >= lower[0]) return (voltage - lower[0]) / (upper[0] - lower[0]) * (upper[1] - lower[1]) + lower[1];
  	}
  	return last[1];
  }
  /**
  * Projects mechanical status into the field names the Web API returns, so that
  * the status block reads the same fields over Bluetooth as over the cloud.
  *
  * `wm2State` is deliberately absent: it describes a WiFi Module 2, which is
  * not involved in a Bluetooth session. Callers reading that field receive the
  * empty value rather than a fabricated one.
  */
  function toDeviceStatus(status, now = Date.now()) {
  	const voltage = batteryVoltage(status.battery);
  	return {
  		CHSesame2Status: lockState(status),
  		batteryPercentage: batteryPercentage(voltage),
  		batteryVoltage: voltage,
  		position: status.position,
  		timestamp: Math.floor(now / 1e3)
  	};
  }
  function lockState(status) {
  	if (status.isInLockRange) return "locked";
  	if (status.isInUnlockRange) return "unlocked";
  	return "moved";
  }
  var START_BIT = 1;
  var END_PLAIN = 2;
  var END_CIPHER = 4;
  /**
  * Splits a message into BLE packets. An empty message still produces one
  * packet, because the receiver needs a terminating header to reassemble it.
  */
  function encodeSegments(message, packetSize = 20) {
  	const payloadSize = requirePayloadSize(packetSize);
  	const end = message.parsing === "cipher" ? END_CIPHER : END_PLAIN;
  	const packets = [];
  	const total = Math.max(1, Math.ceil(message.data.length / payloadSize));
  	for (let index = 0; index < total; index += 1) {
  		const chunk = message.data.subarray(index * payloadSize, (index + 1) * payloadSize);
  		const header = (index === 0 ? START_BIT : 0) | (index === total - 1 ? end : 0);
  		const packet = new Uint8Array(chunk.length + 1);
  		packet[0] = header;
  		packet.set(chunk, 1);
  		packets.push(packet);
  	}
  	return packets;
  }
  /**
  * Reassembles BLE packets into messages.
  *
  * Notifications arrive one packet at a time, so callers feed packets in as they
  * are received and act on whatever {@link push} returns. The buffer is reset on
  * a start packet, which recovers from a message truncated by a dropped
  * notification rather than silently prefixing the next one.
  */
  var SegmentAssembler = class {
  	constructor() {
  		this.buffer = [];
  		this.started = false;
  	}
  	/** Returns the message once its final packet arrives, otherwise undefined. */
  	push(packet) {
  		const header = packet[0];
  		if (header === void 0) throw new Error("Received an empty Sesame BLE packet.");
  		if ((header & START_BIT) !== 0) {
  			this.buffer = [];
  			this.started = true;
  		} else if (!this.started) return;
  		this.buffer.push(...packet.subarray(1));
  		const parsing = endParsingType(header);
  		if (parsing === void 0) return void 0;
  		const data = Uint8Array.from(this.buffer);
  		this.reset();
  		return {
  			parsing,
  			data
  		};
  	}
  	reset() {
  		this.buffer = [];
  		this.started = false;
  	}
  };
  function endParsingType(header) {
  	if ((header & END_CIPHER) !== 0) return "cipher";
  	if ((header & END_PLAIN) !== 0) return "plain";
  }
  function requirePayloadSize(packetSize) {
  	if (!Number.isInteger(packetSize) || packetSize < 2) throw new TypeError("Sesame BLE packet size must be an integer above one.");
  	return packetSize - 1;
  }
  new Uint8Array([0]);
  /**
  * Splits a plaintext request into packets.
  *
  * Only the login request travels unencrypted, before the session key has been
  * proven. Everything afterwards goes through {@link KeyholderSession.seal}.
  */
  function segmentPlaintext(message) {
  	return encodeSegments({
  		parsing: "plain",
  		data: message
  	});
  }
  //#endregion
  //#region src/ble/ble-transport.ts
  var DEFAULT_TIMEOUTS = {
  	randomCode: 5e3,
  	login: 5e3,
  	command: 5e3,
  	status: 3e3
  };
  var BLE_CAPABILITIES = /* @__PURE__ */ new Set(["statusEvents"]);
  var SesameBleTransport = class {
  	constructor(options) {
  		this.options = options;
  		this.state = "idle";
  		this.assembler = new SegmentAssembler();
  		this.waiters = /* @__PURE__ */ new Set();
  		this.listeners = /* @__PURE__ */ new Set();
  		this.decoding = Promise.resolve();
  		this.requests = Promise.resolve();
  		this.timeouts = {
  			...DEFAULT_TIMEOUTS,
  			...options.timeouts
  		};
  		this.now = options.now ?? Date.now;
  	}
  	capabilities() {
  		return BLE_CAPABILITIES;
  	}
  	isLoggedIn() {
  		return this.state === "ready";
  	}
  	async connect() {
  		if (this.state === "ready") return;
  		if (this.state !== "idle") throw new Error(this.state === "closed" ? "This Sesame connection is closed. Open a new one." : "This Sesame connection is already being established.");
  		this.state = "connecting";
  		try {
  			this.unsubscribe = this.options.channel.subscribe((packet) => {
  				this.receive(packet);
  			});
  			const randomCode = (await this.expect((message) => message.type === OpCode.publish && message.itemCode === ItemCode.initial, this.timeouts.randomCode, "The Sesame did not start a session. Move closer and try again.")).payload.slice(0, 4);
  			if (randomCode.length !== 4) throw new Error("The Sesame sent a malformed session start.");
  			const { session, loginProof } = await this.options.keyholder.startSession(this.options.deviceName, randomCode);
  			this.session = session;
  			const response = this.expect((message) => message.type === OpCode.response && message.itemCode === ItemCode.login, this.timeouts.login, "The Sesame did not answer the login request.");
  			await this.writeAll(segmentPlaintext(encodeRequest(ItemCode.login, loginProof)));
  			requireSuccess(await response, "log in to the Sesame");
  			this.state = "ready";
  		} catch (error) {
  			await this.close();
  			throw error;
  		}
  	}
  	async getStatus() {
  		this.requireReady();
  		if (this.lastStatus !== void 0) return toDeviceStatus(this.lastStatus, this.now());
  		const published = this.expect((message) => message.type === OpCode.publish && message.itemCode === ItemCode.mechStatus, this.timeouts.status, "The Sesame did not report its state.");
  		await this.send(encodeRequest(ItemCode.mechStatus));
  		await published;
  		if (this.lastStatus === void 0) throw new Error("The Sesame did not report its state.");
  		return toDeviceStatus(this.lastStatus, this.now());
  	}
  	async sendCommand(command, history) {
  		this.requireReady();
  		const resolved = await this.resolveCommand(command);
  		const itemCode = COMMAND_ITEM_CODES[resolved];
  		const response = this.expect((message) => message.type === OpCode.response && message.itemCode === itemCode, this.timeouts.command, `The Sesame did not answer the ${resolved} request.`);
  		await this.send(encodeRequest(itemCode, encodeHistoryTag(history)));
  		requireSuccess(await response, `${resolved} the Sesame`);
  		return { command: resolved };
  	}
  	onStatusChange(listener) {
  		this.listeners.add(listener);
  		return () => {
  			this.listeners.delete(listener);
  		};
  	}
  	async close() {
  		if (this.state === "closed") return;
  		this.state = "closed";
  		this.failWaiters(/* @__PURE__ */ new Error("The Sesame connection closed."));
  		this.unsubscribe?.();
  		this.unsubscribe = void 0;
  		this.assembler.reset();
  		const session = this.session;
  		this.session = void 0;
  		this.listeners.clear();
  		await session?.close();
  		await this.options.channel.close();
  	}
  	/**
  	* The Bluetooth protocol has no toggle item code, so it is resolved here from
  	* the reported state.
  	*/
  	async resolveCommand(command) {
  		if (command !== "toggle") return command;
  		if (this.lastStatus === void 0) await this.getStatus();
  		if (this.lastStatus === void 0) throw new Error("Cannot toggle without knowing whether the Sesame is locked.");
  		return this.lastStatus.isInLockRange ? "unlock" : "lock";
  	}
  	requireReady() {
  		if (this.state !== "ready") throw new Error("Connect to the Sesame first.");
  	}
  	/** Seals a request and writes it, one request at a time. */
  	async send(message) {
  		const session = this.session;
  		if (session === void 0) throw new Error(this.state === "closed" ? "The Sesame connection closed." : "Connect to the Sesame first.");
  		const run = this.requests.then(async () => {
  			await this.writeAll(await session.seal(message));
  		});
  		this.requests = run.catch(() => void 0);
  		await run;
  	}
  	async writeAll(packets) {
  		for (const packet of packets) await this.options.channel.write(packet);
  	}
  	/** Registers a one-shot waiter for the next message matching `matches`. */
  	expect(matches, timeoutMs, timeoutMessage) {
  		return new Promise((resolve, reject) => {
  			const waiter = {
  				matches,
  				settle: (message) => {
  					clearTimeout(timer);
  					this.waiters.delete(waiter);
  					resolve(message);
  				},
  				fail: (error) => {
  					clearTimeout(timer);
  					this.waiters.delete(waiter);
  					reject(error);
  				}
  			};
  			const timer = setTimeout(() => {
  				waiter.fail(new Error(timeoutMessage));
  			}, timeoutMs);
  			this.waiters.add(waiter);
  		});
  	}
  	receive(packet) {
  		let frame;
  		try {
  			frame = this.assembler.push(packet);
  		} catch (error) {
  			this.failWaiters(asError(error));
  			return;
  		}
  		if (frame === void 0) return;
  		const complete = frame;
  		this.decoding = this.decoding.then(() => this.handleFrame(complete)).catch((error) => {
  			this.failWaiters(asError(error));
  		});
  	}
  	async handleFrame(frame) {
  		const session = this.session;
  		let data;
  		if (session === void 0) {
  			if (frame.parsing !== "plain") throw new Error("The Sesame sent an encrypted frame before the session started.");
  			data = frame.data;
  		} else data = await session.open(frame.parsing, frame.data);
  		const message = decodeMessage(data);
  		if (message.type === OpCode.publish && message.itemCode === ItemCode.mechStatus) {
  			this.lastStatus = decodeMechStatus(message.payload);
  			this.emit(toDeviceStatus(this.lastStatus, this.now()));
  		}
  		for (const waiter of this.waiters) if (waiter.matches(message)) {
  			waiter.settle(message);
  			return;
  		}
  	}
  	emit(status) {
  		for (const listener of [...this.listeners]) try {
  			listener(status);
  		} catch {}
  	}
  	failWaiters(error) {
  		for (const waiter of [...this.waiters]) waiter.fail(error);
  	}
  };
  /**
  * Encodes the tag recorded in the device's own history list.
  *
  * The payload is the byte length followed by the UTF-8 bytes. Truncation
  * happens on a character boundary, so a multi-byte character is dropped whole
  * rather than cut in half.
  */
  function encodeHistoryTag(tag) {
  	const encoded = new TextEncoder().encode(tag);
  	let length = Math.min(encoded.length, 29);
  	while (length > 0 && ((encoded[length] ?? 0) & 192) === 128) length -= 1;
  	const payload = new Uint8Array(length + 1);
  	payload[0] = length;
  	payload.set(encoded.subarray(0, length), 1);
  	return payload;
  }
  function requireSuccess(message, action) {
  	if (message.result !== ResultCode.success) throw new Error(`The Sesame refused to ${action} (result ${String(message.result)}).`);
  }
  function asError(error) {
  	return error instanceof Error ? error : new Error(String(error));
  }
  //#endregion
  //#region src/ble/remote-keyholder.ts
  /** Long enough for a biometric prompt, short enough to not hang a project. */
  var DEFAULT_TIMEOUT_MS = 12e4;
  /**
  * Validates a keyholder URL.
  *
  * It must be `https` and carry only an origin and path: a keyholder reached
  * over plain HTTP, or selected by a query string, is not a boundary worth
  * having.
  */
  function validateKeyholderUrl(value) {
  	let url;
  	try {
  		url = new URL(value.trim());
  	} catch {
  		throw new TypeError("Keyholder URL must be a valid URL.");
  	}
  	if (url.protocol !== "https:") throw new TypeError("Keyholder URL must use HTTPS.");
  	if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) throw new TypeError("Keyholder URL must contain only an origin and path.");
  	return url.toString();
  }
  var RemoteKeyholder = class {
  	constructor(options) {
  		this.options = options;
  		this.pending = /* @__PURE__ */ new Map();
  		this.nextId = 1;
  		this.url = new URL(validateKeyholderUrl(options.url));
  		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  	}
  	async isPaired(deviceName) {
  		return await this.call("isPaired", { deviceName }) === true;
  	}
  	async pair() {
  		const record = asRecord(await this.call("pair", {}), "pairing");
  		const deviceName = asString(record.deviceName, "deviceName");
  		const uuid = asString(record.uuid, "uuid");
  		const level = record.level;
  		return {
  			deviceName,
  			uuid,
  			...typeof level === "string" ? { level } : {}
  		};
  	}
  	async startSession(deviceName, randomCode) {
  		const record = asRecord(await this.call("startSession", {
  			deviceName,
  			randomCode
  		}), "session start");
  		const sessionId = asString(record.sessionId, "sessionId");
  		const loginProof = asBytes(record.loginProof, "loginProof");
  		if (loginProof.length !== 4) throw new Error("The keyholder returned a malformed login proof.");
  		return {
  			session: new RemoteSession(this, sessionId),
  			loginProof
  		};
  	}
  	/** Releases the iframe and fails anything still outstanding. */
  	dispose() {
  		for (const [, request] of this.pending) {
  			clearTimeout(request.timer);
  			request.reject(/* @__PURE__ */ new Error("The keyholder connection closed."));
  		}
  		this.pending.clear();
  		this.port?.close();
  		this.port = void 0;
  		this.connecting = void 0;
  		this.frame?.remove();
  		this.frame = void 0;
  	}
  	/** @internal Used by {@link RemoteSession}. */
  	async call(method, params) {
  		const port = await this.connect();
  		const id = this.nextId;
  		this.nextId += 1;
  		return new Promise((resolve, reject) => {
  			const timer = setTimeout(() => {
  				this.pending.delete(id);
  				reject(/* @__PURE__ */ new Error(`The keyholder did not answer the ${method} request.`));
  			}, this.timeoutMs);
  			this.pending.set(id, {
  				resolve,
  				reject,
  				timer
  			});
  			port.postMessage({
  				id,
  				method,
  				params
  			});
  		});
  	}
  	connect() {
  		if (this.port !== void 0) return Promise.resolve(this.port);
  		this.connecting ?? (this.connecting = this.open().catch((error) => {
  			this.connecting = void 0;
  			throw error;
  		}));
  		return this.connecting;
  	}
  	open() {
  		if (typeof document === "undefined") throw new Error("A keyholder needs a browser document.");
  		return new Promise((resolve, reject) => {
  			const frame = document.createElement("iframe");
  			frame.src = this.url.toString();
  			frame.setAttribute("aria-hidden", "true");
  			frame.setAttribute("title", "Sesame keyholder");
  			frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  			this.frame = frame;
  			const timer = setTimeout(() => {
  				reject(/* @__PURE__ */ new Error("The keyholder did not load."));
  			}, this.timeoutMs);
  			frame.addEventListener("load", () => {
  				const channel = new MessageChannel();
  				channel.port1.onmessage = (event) => {
  					if (event.data?.ready === true) {
  						clearTimeout(timer);
  						channel.port1.onmessage = (message) => {
  							this.receive(message);
  						};
  						this.port = channel.port1;
  						resolve(channel.port1);
  						return;
  					}
  					this.receive(event);
  				};
  				frame.contentWindow?.postMessage({ sesameKeyholder: 1 }, this.url.origin, [channel.port2]);
  			});
  			frame.addEventListener("error", () => {
  				clearTimeout(timer);
  				reject(/* @__PURE__ */ new Error("The keyholder failed to load."));
  			});
  			(this.options.container ?? document.body).append(frame);
  		});
  	}
  	receive(event) {
  		const data = event.data;
  		if (data === null || typeof data.id !== "number") return;
  		const request = this.pending.get(data.id);
  		if (request === void 0) return;
  		this.pending.delete(data.id);
  		clearTimeout(request.timer);
  		if (data.ok === true) request.resolve(data.value);
  		else request.reject(new Error(typeof data.error === "string" ? data.error : "The keyholder reported an error."));
  	}
  };
  var RemoteSession = class {
  	constructor(keyholder, sessionId) {
  		this.keyholder = keyholder;
  		this.sessionId = sessionId;
  	}
  	async seal(message) {
  		const result = await this.keyholder.call("seal", {
  			sessionId: this.sessionId,
  			message
  		});
  		if (!Array.isArray(result)) throw new Error("The keyholder returned malformed packets.");
  		return result.map((packet, index) => asBytes(packet, `packet ${index}`));
  	}
  	async open(parsing, data) {
  		return asBytes(await this.keyholder.call("open", {
  			sessionId: this.sessionId,
  			parsing,
  			data
  		}), "frame");
  	}
  	async close() {
  		await this.keyholder.call("closeSession", { sessionId: this.sessionId });
  	}
  };
  function asRecord(value, what) {
  	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`The keyholder returned a malformed ${what} result.`);
  	return value;
  }
  function asString(value, field) {
  	if (typeof value !== "string" || value.length === 0) throw new Error(`The keyholder returned no ${field}.`);
  	return value;
  }
  function asBytes(value, what) {
  	if (value instanceof Uint8Array) return value;
  	if (value instanceof ArrayBuffer) return new Uint8Array(value);
  	throw new Error(`The keyholder returned a malformed ${what}.`);
  }
  //#endregion
  //#region src/ble/web-bluetooth.ts
  /** True when this browser exposes Web Bluetooth at all. */
  function isWebBluetoothAvailable() {
  	return bluetooth() !== void 0;
  }
  /**
  * Opens the browser's device chooser and connects to the chosen Sesame.
  *
  * Must be called from a user gesture: `requestDevice` requires transient user
  * activation, which a block evaluated in the VM's step loop only has for a few
  * seconds after a click.
  */
  async function requestSesameChannel() {
  	const api = bluetooth();
  	if (api === void 0) throw new Error("This browser has no Web Bluetooth. Chrome or Edge on desktop or Android is required; use Relay mode otherwise.");
  	const device = await api.requestDevice({
  		filters: [{ services: [SERVICE_UUID] }],
  		optionalServices: [SERVICE_UUID]
  	});
  	const server = device.gatt;
  	if (server === void 0) throw new Error("This Bluetooth device offers no GATT server.");
  	const connected = await server.connect();
  	const service = await connected.getPrimaryService(SERVICE_UUID);
  	const [tx, rx] = await Promise.all([service.getCharacteristic(TX_CHARACTERISTIC_UUID), service.getCharacteristic(RX_CHARACTERISTIC_UUID)]);
  	await rx.startNotifications();
  	return new WebBluetoothChannel(connected, tx, rx, device.name);
  }
  var WebBluetoothChannel = class {
  	constructor(server, tx, rx, deviceName) {
  		this.server = server;
  		this.tx = tx;
  		this.rx = rx;
  		this.deviceName = deviceName;
  		this.listeners = /* @__PURE__ */ new Set();
  		this.closed = false;
  		this.onValue = (event) => {
  			const value = event.target?.value;
  			if (value === void 0) return;
  			const packet = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  			for (const listener of [...this.listeners]) listener(packet);
  		};
  		this.rx.addEventListener("characteristicvaluechanged", this.onValue);
  	}
  	async write(packet) {
  		if (this.closed) throw new Error("This Bluetooth connection is closed.");
  		await this.tx.writeValueWithoutResponse(packet.slice());
  	}
  	subscribe(listener) {
  		this.listeners.add(listener);
  		return () => {
  			this.listeners.delete(listener);
  		};
  	}
  	async close() {
  		if (this.closed) return;
  		this.closed = true;
  		this.rx.removeEventListener("characteristicvaluechanged", this.onValue);
  		this.listeners.clear();
  		try {
  			await this.rx.stopNotifications();
  		} catch {}
  		if (this.server.connected) this.server.disconnect();
  	}
  };
  function bluetooth() {
  	const candidate = globalThis.navigator?.bluetooth;
  	return typeof candidate?.requestDevice === "function" ? candidate : void 0;
  }
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
  		this.stateChanged = false;
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
  	configureBluetooth(args) {
  		this.capture(() => {
  			requireUnsandboxedBluetooth();
  			const keyholderUrl = validateKeyholderUrl(Scratch.Cast.toString(args.KEYHOLDER_URL));
  			const deviceAlias = Scratch.Cast.toString(args.DEVICE_ALIAS).trim();
  			if (deviceAlias.length === 0) throw new TypeError("Give the Sesame a device alias.");
  			this.releaseBluetooth();
  			this.connection = {
  				mode: "bluetooth",
  				keyholderUrl,
  				deviceAlias
  			};
  		});
  	}
  	async pairBluetooth() {
  		await this.captureAsync(async () => {
  			const connection = this.requireBluetooth();
  			const paired = await this.keyholder(connection).pair();
  			this.connection = {
  				...connection,
  				deviceAlias: paired.deviceName
  			};
  		}, void 0);
  	}
  	async connectBluetooth() {
  		await this.captureAsync(async () => {
  			const connection = this.requireBluetooth();
  			if (connection.transport?.isLoggedIn() === true) return;
  			const transport = new SesameBleTransport({
  				channel: await requestSesameChannel(),
  				keyholder: this.keyholder(connection),
  				deviceName: connection.deviceAlias
  			});
  			transport.onStatusChange(() => {
  				this.stateChanged = true;
  			});
  			try {
  				await transport.connect();
  			} catch (error) {
  				await transport.close();
  				throw error;
  			}
  			this.connection = {
  				...connection,
  				transport
  			};
  		}, void 0);
  	}
  	bluetoothConnected() {
  		return this.connection?.mode === "bluetooth" && this.connection.transport?.isLoggedIn() === true;
  	}
  	whenStateChanges() {
  		if (!this.stateChanged) return false;
  		this.stateChanged = false;
  		return true;
  	}
  	clearCredentials() {
  		this.releaseBluetooth();
  		this.connection = void 0;
  		this.lastErrorMessage = "";
  		this.stateChanged = false;
  	}
  	isConfigured() {
  		return this.connection?.mode === "direct" || this.relayPaired() || this.bluetoothConnected();
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
  		if (this.connection?.mode === "bluetooth") {
  			const transport = this.connection.transport;
  			if (transport === void 0 || !transport.isLoggedIn()) throw new Error("Connect to the Sesame over Bluetooth first.");
  			return transport;
  		}
  		throw new Error("Configure Direct mode, the local relay, or Bluetooth first.");
  	}
  	requireBluetooth() {
  		if (this.connection?.mode !== "bluetooth") throw new Error("Configure Bluetooth mode first.");
  		return this.connection;
  	}
  	keyholder(connection) {
  		connection.keyholder ?? (connection.keyholder = new RemoteKeyholder({ url: connection.keyholderUrl }));
  		return connection.keyholder;
  	}
  	async releaseBluetooth() {
  		if (this.connection?.mode !== "bluetooth") return;
  		const { transport, keyholder } = this.connection;
  		await transport?.close().catch(() => void 0);
  		keyholder?.dispose();
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
  function requireUnsandboxedBluetooth() {
  	if (!Scratch.extensions.unsandboxed) throw new Error("Bluetooth mode requires reloading this custom extension with \"Run extension without sandbox\" enabled.");
  	if (!isWebBluetoothAvailable()) throw new Error("This browser has no Web Bluetooth. Chrome or Edge on desktop or Android is required; use Relay mode otherwise.");
  }
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
