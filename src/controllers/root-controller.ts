import { ShardingManager } from 'discord.js';
import { Request, Response, Router } from 'express';
import router from 'express-promise-router';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import qs from 'qs';

import { Env, verifyToken } from '../services';
import { Controller } from './controller';
let Config = require('../../config/config.json');

export class RootController implements Controller {
    public path = '/v5/discord-bot';
    public router: Router = router();

    constructor(private shardManager: ShardingManager) { }

    public register(): void {
        this.router.get('/health', (req, res) => this.get(req, res)); // health check
        this.router.post('/webhooks/thrive', (req, res) => this.thriveWebhook(req, res));
        this.router.get('/webhooks/verify-user', (req, res) => this.verifyUser(req, res));
        this.router.get('/webhooks/register-commands', (req, res) => this.registerCommands(req, res));
        // this.router.get('/webhooks/verify-token', (req, res) => this.verifyToken(req, res)); // disable - was used for auth update
    }

    private async get(req: Request, res: Response): Promise<void> {
        res.status(200).json({ name: 'Discord Bot Cluster API', author: 'Kiril Kartunov' });
    }

    /**
     * Thrive webhook listener
     * Acts upon Contentful webhooks
     */
    private async thriveWebhook(req: Request, res: Response): Promise<void> {
        if (req.body.sys.revision === 1) {
            await fetch(Env.discordThriveWebhook, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: `Hey, we have published a new article on Thrive. Have a look at it https://www.topcoder.com/thrive/articles/${req.body.fields.slug['en-US']}?${qs.stringify({ ...Config.UTMs, 'utm_campaign': 'thrive-articles' })}`
                }),
            });
        }
        res.status(200).end();
    }

    /**
     * Callback webhook to verify user JWT
     * send here as return URL after login/register flow
     * if success user gets verified roles in TC discord server
     */
    private async verifyUser(req: Request, res: Response): Promise<void> {
        try {
            const discord = req.query.discord;
            const token = req.query.token;
            const decodedDiscord: any = jwt.verify(discord as string, Env.token);
            // verfy token comes from TC 4real
            verifyToken(token, Config.validIssuers, async (err: any, decodedToken: any) => {
                if (err) {
                    res.status(400).send(`Bad Request: ${err}`);
                    return;
                } else {
                    console.log('verifyUser', decodedDiscord, decodedToken);
                    const resOps = await this.shardManager.broadcastEval(
                        async (client, context) => {
                            const guild = client.guilds.cache.get(context.serverID);
                            if (!guild) return { success: false, error: `Can\'t find any guild with the ID: ${context.serverID}` };
                            const member = await guild.members.fetch(context.userId);
                            if (member && member.roles.cache.has(context.roleId)) {
                                return { success: true, msg: 'Alredy have the role' };
                            } else if (member) {
                                await member.roles.add(context.roleId);
                                if (member.roles.cache.has(context.guestRoleId)) {
                                    await member.roles.remove(context.guestRoleId);
                                }
                                return { success: true };
                            } else {
                                return { success: false, erorr: 'can not find member by ID' };
                            }
                        },
                        {
                            context: {
                                serverID: Env.serverID, userId: decodedDiscord.data.userId, roleId: Env.verifyRoleID, guestRoleId: Env.guestRoleID
                            }
                        }
                    );
                    if (resOps[0].success) {
                        console.log('decodeOps', decodedDiscord, decodedToken);
                        res.redirect(Env.verifySuccessRedirect);
                    } else res.json(resOps);
                }
            });
        } catch (e) {
            res.status(500).json(e);
            throw e;
        }
    }

    private async registerCommands(req: Request, res: Response): Promise<void> {
        // TODO
    }

    /**
     * Verify a TC jwt token for authenticity
     */
    // private async verifyToken(req: Request, res: Response): Promise<void> {
    //     const token = req.query.token;
    //     if (token) {
    //         try {
    //             verifyToken(token, Config.validIssuers, (err: any, decodedToken: any) => {
    //                 if (err) {
    //                     res.status(400).send(`Bad Request: ${err}`);
    //                 } else {
    //                     res.send(decodedToken);
    //                 }
    //             });
    //         } catch (e) {
    //             res.status(500).send('error: ' + e.message);
    //         };
    //     } else {
    //         res
    //             .status(400)
    //             .send('Bad Request: expecting query param like - ?token=<token>');
    //     }
    // }
}
