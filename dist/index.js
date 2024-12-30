"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const ipPoolManager_1 = require("./ipPoolManager");
const axios_1 = __importDefault(require("axios"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
// WireGuard Configuration Paths
const PRIVATE_KEY_PATH = "/etc/wireguard/private.key";
const PUBLIC_KEY_PATH = "/etc/wireguard/public.key";
const CONFIG_PATH = "/etc/wireguard/wg0.conf";
// IP Pool Manager Instance
const poolManager = (0, ipPoolManager_1.createIPPoolManager)('10.8.0.0/24');
// Utility to execute shell commands
const executeCommand = (command) => new Promise((resolve, reject) => {
    (0, child_process_1.exec)(command, (error, stdout, stderr) => {
        if (error) {
            return reject(stderr || error.message);
        }
        resolve(stdout.trim());
    });
});
// Generate WireGuard keys
const generateKeys = async () => {
    const privateKey = await executeCommand("wg genkey");
    const publicKey = await executeCommand(`echo ${privateKey} | wg pubkey`);
    return { privateKey, publicKey };
};
// Save keys to files
const saveKeys = async (privateKey, publicKey) => {
    await fs_1.promises.writeFile(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    await fs_1.promises.writeFile(PUBLIC_KEY_PATH, publicKey, { mode: 0o600 });
};
// Create WireGuard configuration file
const createConfigFile = async (privateKey) => {
    const configContent = `[Interface]
PrivateKey = ${privateKey}
Address = 10.8.0.1/24
ListenPort = 51820
SaveConfig = true
PostUp = ufw route allow in on wg0 out on enX0
PostUp = iptables -t nat -I POSTROUTING -o enX0 -j MASQUERADE
PreDown = ufw route delete allow in on wg0 out on enX0
PreDown = iptables -t nat -D POSTROUTING -o enX0 -j MASQUERADE
`;
    await fs_1.promises.writeFile(CONFIG_PATH, configContent, { mode: 0o600 });
};
// Set up WireGuard interface
const setupWireGuardInterface = async () => {
    await executeCommand("wg-quick up wg0");
};
// Add peer to WireGuard
const addPeer = async (clientPublicKey, assignedIP) => {
    const command = `wg set wg0 peer ${clientPublicKey} allowed-ips ${assignedIP}/32`;
    await executeCommand(command);
    await executeCommand("wg-quick save wg0");
};
// API Endpoints
app.get("/", (_req, res) => {
    res.status(200).send("Welcome to the WireGuard Server!");
});
app.post("/add-peer", async (req, res) => {
    const { clientPublicKey } = req.body;
    if (!clientPublicKey) {
        return res.status(400).json({ error: "clientPublicKey is required" });
    }
    try {
        const assignedIP = poolManager.assignIP(clientPublicKey);
        // Check if assignedIP is null and return an error if it is
        if (assignedIP === null) {
            return res.status(500).json({ error: "No available IPs" });
        }
        if (assignedIP) {
            console.log('Assigned IP:', assignedIP);
            await addPeer(clientPublicKey, assignedIP);
        }
        else {
            console.log('No available IPs');
        }
        const serverPublicKey = await fs_1.promises.readFile(PUBLIC_KEY_PATH, "utf-8");
        res.status(200).json({
            message: "Peer added successfully",
            assignedIP,
            serverPublicKey: serverPublicKey.trim(),
        });
    }
    catch (error) {
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
            console.error("Add Peer Error:", error);
        }
    }
});
app.post("/remove-peer", async (req, res) => {
    const { clientPublicKey } = req.body;
    if (!clientPublicKey) {
        return res.status(400).json({ error: "clientPublicKey is required" });
    }
    try {
        // Remove peer from WireGuard
        await executeCommand(`wg set wg0 peer ${clientPublicKey} remove`);
        // Remove peer from IP pool
        const success = poolManager.removePeer(clientPublicKey);
        if (success) {
            console.log(`Peer ${clientPublicKey} removed successfully`);
            res.status(200).json({ success: true, message: "Peer removed successfully" });
        }
        else {
            res.status(200).json({ success: false, message: "Peer not found" });
        }
    }
    catch (error) {
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
            console.error("Remove Peer Error:", error);
        }
    }
});
// // Initialize the WireGuard server
// (async () => {
//   try {
//     const { privateKey, publicKey } = await generateKeys();
//     await saveKeys(privateKey, publicKey);
//     await createConfigFile(privateKey);
//     await setupWireGuardInterface();
//     console.log("WireGuard interface is up and running.");
//   } catch (error) {
//     if(error instanceof Error) {
//       console.error("Initialization error:", error.message);
//     }
//   }
// });
app.listen(8000, async () => {
    try {
        console.log("Server is running on http://0.0.0.0:8000");
        const { privateKey, publicKey } = await generateKeys();
        await saveKeys(privateKey, publicKey);
        await createConfigFile(privateKey);
        await setupWireGuardInterface();
        console.log("WireGuard interface is up and running.");
    }
    catch (error) {
        if (error instanceof Error) {
            console.error("Initialization error:", error.message);
        }
    }
});
app.get("/", (_req, res) => {
    res.status(200).send("Welcome to the WireGuard Server!");
});
app.get("/get-public-ip", async (req, res) => {
    try {
        const response = await axios_1.default.get('https://api.ipify.org?format=json');
        const publicIP = response.data.ip; // Extract the IP from the response
        res.status(200).json({ publicIP });
    }
    catch (error) {
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
            console.error("Error fetching public IP:", error);
        }
    }
});
