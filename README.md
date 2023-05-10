<h1><img src="https://passkeys.berrysauce.me/assets/img/android-chrome-192x192.png" alt="Passkey Demo Icon" height=64><br>Passkey Server Demo</h1>

This is a demo login using Passkeys. Passkeys are not new, but they've gained a lot of popularity recently as big tech companies like Apple and Google have implemented them in their products. This demo simulates the registration and authentication of a user using passkeys. The server and client (user's browser) use the [Passwordless.ID WebAuthn implementation](https://github.com/passwordless-id/webauthn). Thanks to them for making such an easy-to-use library!

> **Warning**: I cannot guarantee your data's security. This is just a demo. The data stored on the server is just from your site-specific passkey – which shouldn't be a problem, even if an attacker gets to it. Use it at your own risk. You shouldn't use this in production.

### Stack

- [Server – Cloudflare Workers](https://workers.cloudflare.com/)
- [Router – HonoJS](https://hono.dev/)
- [Frontend – Bootstrap 5](https://getbootstrap.com/)

[Cloudflare Worker JWT](https://github.com/tsndr/cloudflare-worker-jwt) (a very cool library!) is used for the server-side JWT implementation. I also recommend taking a look at [HonoJS](https://hono.dev/). It's a small but powerful router which works with Cloudflare Workers. There's still some work to do with the documentation, but that's ok, as it's quite fresh. It's really great and easy to use.

### How it works

The Passwordless.ID repository has a very nice graphic for how the WebAuthn process works. I'll just copy it here:

<img src="https://passwordless.id/protocols/webauthn/overview.svg" alt="Graphic explaining the WebAuthn process">

<sub>Source: [Passwordless.ID WebAuthn Repository](https://github.com/passwordless-id/webauthn)</sub>

### Development

First, clone the repo to your machine and install all dependencies.
~~Then, run the local development server. Some features might not work in local development mode.~~ 

> **Note**: It seems like the WebAuthn spec requires valid SSL certificates. Currently, local development mode doesn't work. I recommend using `wrangler tail` to get the live logs from your active Cloudflare Worker instance for debugging.

```
npm install
npm run dev
```

You also need to create a file called `.dev.vars` in the project directory with the following content:

```
JWT_TOKEN=<RANDOM TOKEN HERE FOR JWT SIGNING>
```

Additionally, you need to pass the `JWT_TOKEN` onto your active Worker instance via wrangler (more on that [here](https://developers.cloudflare.com/workers/platform/environment-variables/#add-secrets-to-your-project)).

Deploy your passkey application as a Cloudflare Worker via wrangler with the following command.

> **Note**: Do not forget to update your KV namespace bindings in the wrangler.toml file. You need two, one for the production KV and one for the preview KV.

```
npm run deploy
```
