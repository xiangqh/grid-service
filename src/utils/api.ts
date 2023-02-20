import { ApiClient, FuturesApi } from "gate-api";
import { User } from "src/entities/user.entity";
import chacha20 from "./chacha20";


export function buildAPIFromUser(user: User, basePath?: string) {
    const client = new ApiClient();
    if (user) {
        const password = Buffer.alloc(32);
        password.write(user.password);
        const plaintextKey = Buffer.alloc(16);
        plaintextKey.write(user.key, 'hex');
        const plaintextSecret = Buffer.alloc(32);
        plaintextSecret.write(user.secret, 'hex');

        const key = chacha20(plaintextKey, password);
        const secret = chacha20(plaintextSecret, password);
        client.setApiKeySecret(key.toString('hex'), secret.toString('hex'));
    }
    if (basePath) {
        client.basePath = basePath;
    }
    return new FuturesApi(client);
}