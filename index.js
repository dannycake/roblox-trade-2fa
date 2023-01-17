import superagent from 'superagent';
import {generateToken} from 'node-2fa';

const {
    COOKIE: cookie,
    MFA_SECRET: mfaSecret,
    HOUR_DELAY: delayInHours,
} = process.env;

const user = {
    id: 0,
    csrf: 'aabbccdd'
}

const agent =
    superagent
        .agent()
        .set('cookie', `.ROBLOSECURITY=${cookie}`);

const request = (url, method = 'GET', body = {}) => new Promise(resolve => {
    agent[method.toLowerCase()](url)
        .set('x-csrf-token', user.csrf)
        .send(body)
        .then(resolve)
        .catch(error => {
            if (!error.response) {
                console.error(new Error(error.response))
                return resolve();
            }

            const {text, headers} = error.response;
            if (text.includes('Token Validation Failed')) {
                user.csrf = headers['x-csrf-token'];
                return request(url, method, body).then(resolve);
            }

            console.error(`${method} request to "${url}" failed:`, text);

            if (
                text.includes('InternalServerError')
                || text.includes('TooManyRequests')
            ) return request(url, method, body).then(resolve);

            return resolve();
        })
});

const updateUserInfo = async () => {
    const info = await request('https://www.roblox.com/my/settings/json')
    if (!info || !info.body) {
        console.log(`Failed to fetch roblox user info`);
        return process.exit(1);
    }

    user.id = info.body.UserId;
}

const getMfaCode = () => generateToken(mfaSecret).token;
const solveMfa = async () => {
    const uuidRequest = await request(
        'https://trades.roblox.com/v1/trade-friction/two-step-verification/generate',
        'POST', {});
    if (!uuidRequest || !uuidRequest.text) return;

    const uuid = uuidRequest.text.replace(/"/g, '');
    const mfaCode = getMfaCode();

    const verificationCodeRequest = await request(
        `https://twostepverification.roblox.com/v1/users/${user.id}/challenges/authenticator/verify`,
        'POST', {
            challengeId: uuid,
            actionType: 'ItemTrade',
            code: mfaCode.toString()
        }
    )

    if (!verificationCodeRequest || !verificationCodeRequest.body) return;
    const {verificationToken} = verificationCodeRequest.body;

    const redeemCodeRequest = await request(
        'https://trades.roblox.com/v1/trade-friction/two-step-verification/redeem',
        'POST', {
            challengeToken: uuid,
            verificationToken: verificationToken
        }
    )

    if (redeemCodeRequest && redeemCodeRequest.text === 'true')
        console.log(`[${new Date().toLocaleTimeString()}] Successfully completed 2FA on "${user.id}", waiting ${delayInHours} hours before repeating`)
}

await updateUserInfo();

for (;;) {
    await solveMfa();
    await new Promise(resolve => setTimeout(resolve, 1000 * 60 * 60 * delayInHours))
}