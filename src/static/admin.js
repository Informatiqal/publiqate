async function reloadConfig() {
    const reloadResponse = await fetch("/api/reload-config")
    const reload = await reloadResponse.text()

    console.log(reload)
}

async function verifyConfig() {
    const verifyResponse = await fetch("/api/verify-config")
    const verify = await verifyResponse.json()

    console.log(verify)
}

const reloadConfigButton = document.getElementById("reloadConfig");
reloadConfigButton.addEventListener('click', reloadConfig);

const verifyConfigButton = document.getElementById("verifyConfig");
verifyConfigButton.addEventListener('click', verifyConfig);