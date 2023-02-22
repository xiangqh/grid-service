import { ApiClient, FuturesApi } from "gate-api";
import { User } from "src/entities/user.entity";
import chacha20 from "./chacha20";


function encrypt(text: string, password: string, len: number, encoding?: BufferEncoding) {
    const key = Buffer.alloc(32);
    key.write(password);

    const data = Buffer.alloc(len);
    if (encoding) {
        data.write(text, encoding);
    } else {
        data.write(text);
    }

    return chacha20(data, key);
}

export function buildAPIFromUser(user: User, basePath?: string) {
    const client = new ApiClient();
    if (user) {
        const password = encrypt(user.password, global.key, user.password.length / 2, 'hex').toString();
        const key = encrypt(user.key, password, user.key.length / 2, 'hex');
        const secret = encrypt(user.secret, password, user.secret.length / 2, 'hex');
        client.setApiKeySecret(key.toString('hex'), secret.toString('hex'));
    }
    if (basePath) {
        client.basePath = basePath;
    }
    return new FuturesApi(client);
}