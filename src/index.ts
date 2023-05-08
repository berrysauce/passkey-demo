import { Context, Hono } from "hono"
import { html } from "hono/html"
//import { jwt } from "hono/jwt"
import { serveStatic } from "hono/cloudflare-workers"
// @ts-ignore
import { v4 as uuidv4 } from "uuid";
import { server } from "@passwordless-id/webauthn"
import jwt from "@tsndr/cloudflare-worker-jwt"

// WebAuthn Wrapper: https://github.com/passwordless-id/webauthn

type Bindings = {
	DB: KVNamespace
    JWT_TOKEN: string
}

const app = new Hono<{ Bindings: Bindings }>()

// change when locally testing here, in success.html, and in index.html
// DO NOT use http:// in production!
const HTTP_SCHEME = "https://"

const validateSession = async (secret: string, sessionToken: string) => {
    // Check if token exists
    if (sessionToken === null) {
        return false
    }

    let isValid
    try {
        isValid = await jwt.verify(String(sessionToken), secret, { throwError: true } )
    } catch(error) {
        console.log(`[ERROR] – TOKEN VERIFICATION - ${error}`)
        return false
    }
    if (!isValid) {
        return false
    }

    const { payload } = jwt.decode(String(sessionToken))
    
    return payload
}

app.get("/assets/*", serveStatic({ root: "./" }))
app.get("/error", serveStatic({ path: "error.html" }))

app.get("/", serveStatic({ path: "index.html" }), async (c) => {
    const sessionToken = c.req.cookie("session_token")

    // if user is signed in (has a session token), redirect to success page
    if (sessionToken != null) {
        return c.redirect("/success", 301)
    }

    return
})
  
app.get("/success", serveStatic({ path: "success.html" }), async (c) => {
    const sessionToken = c.req.cookie("session_token")

    // check if token is even set
    if (sessionToken === null) {
        return c.text("Unauthorized", 401)
    }  

    // validate token
    let payload = await validateSession(c.env.JWT_TOKEN, String(sessionToken))
    if (payload === false) {
        return c.text("Unauthorized", 401)
    }

    // get data from token
    const username = payload.username

    const check = await c.env.DB.get(username)
    if (check === null) {
        return c.text("Unauthorized", 401)
    }

    return
})

app.get("/getuser", async (c) => {
    // this could be changed to locally decoding the JWT token at the client's side

    const sessionToken = c.req.cookie("session_token")

    // validate token
    let payload = await validateSession(c.env.JWT_TOKEN, String(sessionToken))
    if (payload === false) {
        return c.text("Unauthorized", 401)
    }

    return c.text(payload.username)
})

app.get("/auth/userexists/:username", async (c) => {
    // Check if a user already exists before registration

    const username = c.req.param("username")
    const check = await c.env.DB.get(username)
    if (check === null) {
        return c.text("false")
    } else {
        return c.text("true")
    }
})

app.get("/auth/challenge/:username", async (c) => {
    const username = c.req.param("username")
    const check = await c.env.DB.get(username)

    let includeCredentialId
    if (c.req.query("includeCredentialId") === null) {
        includeCredentialId = false
    } else {
        includeCredentialId = Boolean(c.req.query("includeCredentialId"))
    }

    if (username === null) {
        return c.text("Error - Username required", 400)
    } else if(check != null && includeCredentialId === false) {
        return c.text("Error - Username already exists, use authentication", 400)
    }

    // Generate random UUID v4 as nonce for the client
    const newUUID = String(uuidv4())

    // Get Host header for later validation
    // seems to be checked automatically somewhere in the validation process
    const origin = c.req.header("Host")

    // Store UUID and request origin in DB for later validation
    // only https:// supported (because I say so)
    const data = {
        challenge: newUUID,
        origin: HTTP_SCHEME + origin
    }
    // challenge entry will be automatically removed after 15 seconds
    // minimum KV expiration is 60
    await c.env.DB.put(username + "-challenge", JSON.stringify(data), {expirationTtl: 60});

    if (includeCredentialId === true) {
        let userCredentials = await c.env.DB.get(username)
        userCredentials = JSON.parse(String(userCredentials))

        // @ts-ignore
        return c.text(newUUID + "///" + userCredentials.credential.id)   
    }

    return c.text(newUUID)
})

app.post("/auth/validate", async (c) => {
    const registration = await c.req.json()

    // Get initiated registration
    const expected = await c.env.DB.get(registration["username"] + "-challenge")
    if (expected === null) {
        return c.text("Error - Challenge not found", 404)
    }

    // Validate registration call from the client
    // const cannot be used in try/catch block (block scoping)
    let registrationParsed
    try {
        registrationParsed = await server.verifyRegistration(registration, JSON.parse(expected))
    } catch(error) {
        console.log(`[ERROR] – /auth/validate – REGISTRATION VERIFICATION - ${error}`)
        await c.env.DB.delete(registration["username"]);
        return c.redirect("/error", 403)
    }

    await c.env.DB.delete(registration["username"]);
    await c.env.DB.put(registration["username"], JSON.stringify(registrationParsed));

    const payload = {
        username: registration["username"],
        exp: Math.floor(Date.now() / 1000) + (12 * (60 * 60)) // Expires: Now + 12h
    };

    let token
    try {
        token = await jwt.sign(payload, c.env.JWT_TOKEN)
    } catch(error) {
        console.log(`[ERROR] – /auth/validate – TOKEN SIGNING - ${error}`)
        return c.redirect("/error", 500)
    }
    
    c.cookie("session_token", token, {path: "/", expires: new Date(payload.exp * 1000)})
    return c.text("Registration successfull")
})

app.post("/auth/login/:username", async (c) => {
    const username = c.req.param("username")
    const authentication = await c.req.json()
    let expected = await c.env.DB.get(username + "-challenge")

    if (expected === null) {
        return c.text("Error - Challenge not found", 404)
    }
    
    expected = JSON.parse(String(expected))
    // @ts-ignore
    expected.userVerified = true

    let credentialKey = await c.env.DB.get(username)
    credentialKey = JSON.parse(String(credentialKey))
    // @ts-ignore
    credentialKey = credentialKey.credential
    
    let authenticationParsed
    try {
        // @ts-ignore
        const authenticationParsed = await server.verifyAuthentication(authentication, credentialKey, expected)
    } catch(error) {
        console.log(`[ERROR] – /auth/login – AUTHENTICATION VERIFICATION - ${error}`)
        await c.env.DB.delete(username + "-challenge");
        return c.redirect("/error", 403)
    }

    await c.env.DB.delete(username + "-challenge");

    const payload = {
        username: username,
        exp: Math.floor(Date.now() / 1000) + (12 * (60 * 60)) // Expires: Now + 12h
    };

    let token
    try {
        token = await jwt.sign(payload, c.env.JWT_TOKEN)
    } catch(error) {
        console.log(`[ERROR] – /auth/login – TOKEN SIGNING - ${error}`)
        return c.redirect("/error", 500)
    }
    
    c.cookie("session_token", token, {path: "/", expires: new Date(payload.exp * 1000)})
    return c.text("Authentication successfull")
})

app.get("/auth/signout", async (c) => {
    // Set empty cookie that immediately expires
    c.cookie("session_token", "", {path: "/", expires: new Date(0)})
    return c.redirect("/", 301)
})

app.get("/auth/delete", async (c) => {
    const sessionToken = c.req.cookie("session_token")

    // validate token
    let payload = await validateSession(c.env.JWT_TOKEN, String(sessionToken))
    if (payload === false) {
        return c.text("Unauthorized", 401)
    }

    // Remove user from DB
    await c.env.DB.delete(payload.username);

    // Set empty cookie that immediately expires
    c.cookie("session_token", "", {path: "/", expires: new Date(0)})
    return c.redirect("/", 301)
})

export default app
