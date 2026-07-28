// MSAL Configuration
const msalConfig = {
    auth: {
        // The user's provided App Registration Client ID
        clientId: "f413c96e-ca57-42d9-ad9e-932a593397a5",
        // Locked specifically to the user's Enterprise directory
        authority: "https://login.microsoftonline.com/6400282f-d7ad-425f-b19d-a943c2538d80",
        // Ensure redirect returns to the portal origin
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin + "/login.html"
    },
    cache: {
        cacheLocation: "sessionStorage", // 'localStorage' could be used, but session is safer for this
        storeAuthStateInCookie: false,
    }
};

const loginRequest = {
    // OpenID Connect scopes required for JWT verification
    scopes: ["openid", "profile", "User.Read"]
};

// Create the MSAL Client
const myMSALObj = new msal.PublicClientApplication(msalConfig);

async function signIn() {
    try {
        const loginResponse = await myMSALObj.loginPopup(loginRequest);
        console.log("Login successful:", loginResponse);
        sessionStorage.setItem('packemon_user', JSON.stringify(loginResponse.account));

        // Redirect to dashboard
        window.location.href = '/';
    } catch (error) {
        console.error("Login failed:", error);
        alert("Failed to authenticate with Microsoft Entra ID. See console for details.");
    }
}

function signOut() {
    const logoutRequest = {
        account: myMSALObj.getAccountByUsername(getCurrentUser()?.username)
    };
    sessionStorage.removeItem('packemon_user');
    myMSALObj.logoutPopup(logoutRequest).then(() => {
        window.location.href = '/login.html';
    });
}

function getCurrentUser() {
    const user = sessionStorage.getItem('packemon_user');
    return user ? JSON.parse(user) : null;
}

// Ensure the user actually has a valid local session caching their MSAL payload
function enforceAuthentication() {
    // If we're inside the secondary MSAL auth popup, do not redirect, let MSAL process the hash!
    if (window.opener || window !== window.parent) {
        return;
    }

    const user = getCurrentUser();
    const isLoginPage = window.location.pathname.endsWith('login.html');

    if (!user && !isLoginPage) {
        // Automatically bounce unauthorized visitors to the login gate
        window.location.replace('/login.html');
    }
}

// Silently acquire token for API calls
async function getAuthToken() {
    const account = getCurrentUser();
    if (!account) return null;

    const request = {
        ...loginRequest,
        account: myMSALObj.getAccountByUsername(account.username)
    };

    try {
        const response = await myMSALObj.acquireTokenSilent(request);
        return response.idToken; // Using idToken for the Express backend auth middleware
    } catch (error) {
        console.warn("Silent token acquisition failed. Asking for popup permission.", error);
        try {
            const response = await myMSALObj.acquireTokenPopup(request);
            return response.idToken;
        } catch (popupError) {
            console.error("Token acquisition completely failed.", popupError);
            signOut(); // Force logout if tokens cannot be silently renewed
            return null;
        }
    }
}

// Fetch Wrapper that automatically injects the Bearer token into all /api/ requests
async function secureFetch(url, options = {}) {
    // If it's a backend API endpoint, intercept and securely sign the request
    if (url.startsWith('/api')) {
        const token = await getAuthToken();
        if (!token) throw new Error("Unauthenticated user: Cannot make API requests.");

        // Prepare headers map
        options.headers = options.headers || {};
        // Use Headers object gracefully if user passed one
        if (options.headers instanceof Headers) {
            options.headers.append('Authorization', `Bearer ${token}`);
        } else {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
    }

    return fetch(url, options);
}
