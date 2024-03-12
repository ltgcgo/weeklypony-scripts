"use strict";

import ServerEvents from "../../libs/eclipsed/client.mjs";
import jsSHA3 from "../../libs/jsSHA/sha3.js";
//import {SmallBot} from "../../libs/small-bot-matrix/mod.ts";

const instance = Deno.env.get("INSTANCE");
const token = Deno.env.get("MASTO_TOKEN");
const lavInst = Deno.env.get("LAV_INST");
const lavToken = Deno.env.get("LAV_TOKEN");
const lavComId = parseInt(Deno.env.get("LAV_COM_ID"));
const mxToken = Deno.env.get("MX_TOKEN");
const mxRoom = Deno.env.get("MX_ROOM");

// Hash provider
let hashProvider = (text) => {
	let hashHost = new jsSHA3(`SHA3-224`, `TEXT`, {"encoding": "UTF8"});
	hashHost.update(text);
	return hashHost.getHash(`B64`).slice(0, 32);
};

console.info(`The bot will send messages to this room: ${mxRoom}`);

// Matrix integration
/*
console.info(`Logging in into the Matrix account...`);
let mxClient = new SmallBot({
	"accessToken": mxToken
});
await mxClient.start();
await mxClient.sendMessage(mxRoom, "m.text", `Daily Scoop has successfully logged in into this Matrix account! Will connect to Mastodon soon.`);
console.info(`Logged in into the Matrix account.`);
*/

// Mastodon integration
// Mastodon notification sifting
let onNotify = async (post, onBoot = false) => {
	let timeNow = Date.now();
	if (post.type != "mention") {
		console.info(`Post was not a mention: ${post.status && post.status.url} (${post.id})`);
		return;
	};
	let botNotMentioned = true;
	if (post.status.mentions) {
		// The bot is not yet "self-aware"...
		botNotMentioned = false;
	} else {
		console.info(`Post didn't contain a mention: ${post.status.url}`);
		return;
	};
	if (botNotMentioned) {
		console.info(`Post didn't mention the bot: ${post.status.url}`);
		return;
	};
	let tagNotAttached = true;
	if (post.status.tags) {
		post.status.tags.forEach(({name}) => {
			if (name.toLowerCase() == "weeklypony") {
				tagNotAttached = false;
			};
		});
	};
	if (tagNotAttached) {
		console.info(`Post didn't attach an appropriate tag: ${post.status.url}`);
		return;
	};
	let target = post;
	if (!post.status.media_attachments?.length) {
		// The post may not be a submission itself
		//console.info(`Post didn't offer attachments, so trying to trace up: ${post.status.url}`);
		if (post.status.in_reply_to_id) {
			try {
				let targetRaw = await (await fetch (`https://${instance}/api/v1/statuses/${post.status.in_reply_to_id}`, {
					"headers": {
						"Authorization": `Bearer ${token}`
					}
				})).json();
				target = {
					"account": targetRaw.account,
					"status": targetRaw
				}
			} catch (err) {
				console.info(`Tracing failed: ${post.status.url}`);
			};
		} else {
			console.info(`No replies, falling back: ${post.status.url}`);
		};
	};
	let timePost = new Date(target.status.created_at),
	timePostMs = timePost.getTime();
	let issueId = Math.floor((timeNow + 367200000) / 604800000) - 2818;
	let lastAllowedMs = (issueId + 2817) * 604800000 - 367200000,
	lastAllowed = new Date(lastAllowedMs);
	if (lastAllowedMs > timePostMs) {
		console.debug(`Way past submission time: ${target.status.url}`);
		if (onBoot) {
			console.debug(`Skipped replying during boot.`);
			return;
		};
		try {
			let mastoResponse = await fetch(`https://${instance}/api/v1/statuses`, {
				"method": `POST`,
				"headers": {
					"Authorization": `Bearer ${token}`,
					"Content-Type": `application/json`,
					"Idempotency-Key": hashProvider(`${target.account.acct}\t${target.status.id}`)
				},
				"body": `{"status":"Sorry, but the submission is way past the deadline for issue ${issueId}. Submissions must be posted after 18:00 UTC+0 ${lastAllowed.getUTCDate()}/${lastAllowed.getUTCMonth() + 1}/${lastAllowed.getUTCFullYear()} to be accepted for the ongoing issue.","in_reply_to_id":"${post.status.id}","media_ids":[],"sensitive":false,"spoiler_text":"","visibility":"direct","language":"en"}`
			});
		} catch (err) {
			console.debug(`Replying failed: ${post.status.url}\n${err.stack}`);
		};
		return;
	};
	console.debug(`Submitted:  ${target.status.url}`);
	console.debug(`Submission: ${post.status.url}`);
	// Reply for notification
	if (onBoot) {
		console.debug(`Skipped replying during boot.`);
		return;
	};
	try {
		// See if already replied
		let replyCount = (await (await fetch(`https://${instance}/api/v1/statuses/${post.status.id}/context`, {
			"cache": "no-store"
		})).json()).descendants?.length || -1;
		if (replyCount > 0) {
			console.debug(`Post already replied (${replyCount}). Ignored.`);
			return;
		} else {
			console.debug(`Trying to notify about a successful submission... (${replyCount})`);
		};
		// If not replied already
		let handle = target.account.acct;
		if (handle.indexOf("@") < 0) {
			handle += `@${instance}`;
		};
		let submitterHandle = post.account.acct;
		if (submitterHandle.indexOf("@") < 0) {
			submitterHandle += `@${instance}`;
		};
		let assembledPreviews = [];
		target.status.media_attachments.forEach(({preview_url}) => {
			assembledPreviews.push(`![](${preview_url})`);
		});
		assembledPreviews.push(`*(Submitted by \`@${submitterHandle}\`)*`);
		assembledPreviews.push(`*If not denied, this submission should appear in issue ${issueId}.*`);
		// Public submission
		let lavenderResponse = await fetch(`https://${lavInst}/api/v3/post`, {
			"method": "POST",
			"headers": {
				"Content-Type": "application/json"
			},
			"body": JSON.stringify({
				"community_id": lavComId,
				"url": target.status.url,
				"name": `Artwork by @${handle}`,
				"body": assembledPreviews.join("\n\n"),
				"auth": lavToken
			})
		});
		//console.debug(lavenderResponse);
		console.debug(`Lavender post status: ${lavenderResponse.status} ${lavenderResponse.statusText}`);
		let lavenderPost = await lavenderResponse.json();
		//console.debug(lavenderPost);
		// Private reply
		let mastoResponse = await fetch(`https://${instance}/api/v1/statuses`, {
			"method": `POST`,
			"headers": {
				"Authorization": `Bearer ${token}`,
				"Content-Type": `application/json`,
				"Idempotency-Key": hashProvider(`${target.account.acct}\t${target.status.id}`)
			},
			"body": `{"status":"@${post.account.acct}\\nWork by @${target.account.acct} has successfully been submitted!\\nLavender URL: ${lavenderPost.post_view.post.ap_id}","in_reply_to_id":"${post.status.id}","media_ids":[],"sensitive":false,"spoiler_text":"","visibility":"direct","language":"en"}`
		});
	} catch (err) {
		console.debug(`Replying failed: ${post.status.url}\n${err.stack}`);
	};
	//console.info(`[${post.account.display_name}](${post.account.url}) (\`@${post.account.acct}\`) submitted an entry from [${target.account.display_name}](${target.account.url}) (\`@${target.account.acct}\`)!\nView: ${target.status.url}`);
};

// Mastodon login
console.info(`Connecting to Mastodon...`);
let sseClient = new ServerEvents(`https://${instance}/api/v1/streaming/user`, {
	"headers": {
		"Authorization": `Bearer ${token}`
	}
}); // Listen to new notifications
sseClient.addEventListener("connecting", () => {
	console.debug(`Client connecting...`);
});
sseClient.addEventListener("open", async () => {
	console.debug(`Client connected.`);
	//await mxClient.sendMessage(mxRoom, "m.text", `Daily Scoop has successfully logged into Mastodon! Now listening for mentions.`);
});
sseClient.addEventListener("disconnect", () => {
	console.debug(`Client disconnected.`);
});
sseClient.addEventListener("close", () => {
	console.debug(`Client closed.`);
});
sseClient.addEventListener("notification", async ({data}) => {
	let post = JSON.parse(data);
	await onNotify(post);
});
try {
	// Sift through old notifications
	let oldNews = await (await fetch(`https://${instance}/api/v1/notifications?exclude_types[]=follow_request`, {
		"headers": {
			"Authorization": `Bearer ${token}`
		}
	})).json();
	for (let i = 0; i < oldNews.length; i ++) {
		await onNotify(oldNews[i], true);
	};
} catch (err) {
	console.debug(`Old notification parsing error.\n${err.stack}`);
};
