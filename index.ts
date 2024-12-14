import express, { Request, Response } from "express";
import { exec } from "child_process";
import { promises as fs } from "fs";
import { AddressInfo } from "net";
import { IPPoolManager, createIPPoolManager } from './ipPoolManager';


const app = express();
app.use(express.json());

// WireGuard Configuration Paths
const PRIVATE_KEY_PATH = "/etc/wireguard/private.key";
const PUBLIC_KEY_PATH = "/etc/wireguard/public.key";
const CONFIG_PATH = "/etc/wireguard/wg0.conf";


// IP Pool Manager Instance
const poolManager = createIPPoolManager('10.8.0.0/24');

// Utility to execute shell commands
const executeCommand = (command: string): Promise<string> =>
  new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(stderr || error.message);
      }
      resolve(stdout.trim());
    });
  });

// Generate WireGuard keys
const generateKeys = async (): Promise<{
  privateKey: string;
  publicKey: string;
}> => {
  const privateKey = await executeCommand("wg genkey");
  const publicKey = await executeCommand(`echo ${privateKey} | wg pubkey`);
  return { privateKey, publicKey };
};

// Save keys to files
const saveKeys = async (
  privateKey: string,
  publicKey: string
): Promise<void> => {
  await fs.writeFile(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  await fs.writeFile(PUBLIC_KEY_PATH, publicKey, { mode: 0o600 });
};

// Create WireGuard configuration file
const createConfigFile = async (privateKey: string): Promise<void> => {
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
  await fs.writeFile(CONFIG_PATH, configContent, { mode: 0o600 });
};

// Set up WireGuard interface
const setupWireGuardInterface = async (): Promise<void> => {
  await executeCommand("wg-quick up wg0");
};

// Add peer to WireGuard
const addPeer = async (
  clientPublicKey: string,
  assignedIP: string
): Promise<void> => {
  const command = `wg set wg0 peer ${clientPublicKey} allowed-ips ${assignedIP}/32`;
  await executeCommand(command);
  await executeCommand("wg-quick save wg0");
};

// API Endpoints
app.get("/", (_req: Request, res: Response) => {
  res.status(200).send("Welcome to the WireGuard Server!");
});

app.post("/add-peer", async (req: Request, res: Response): Promise<any> => {
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
      } else {
        console.log('No available IPs');
      }


    const serverPublicKey = await fs.readFile(PUBLIC_KEY_PATH, "utf-8");

    res.status(200).json({
      message: "Peer added successfully",
      assignedIP,
      serverPublicKey: serverPublicKey.trim(),
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
      console.error("Add Peer Error:", error);
    }
  }
});

app.post("/remove-peer", async (req: Request, res: Response): Promise<any> => {
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
      res.status(200).json({ message: "Peer removed successfully" });
    } else {
      res.status(404).json({ error: "Peer not found" });
    }
  } catch (error) {
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
  } catch (error) {
    if (error instanceof Error) {
      console.error("Initialization error:", error.message);
    }
  }
})

app.get("/", (_req, res) => {
  res.status(200).send("Welcome to the WireGuard Server!");
})
