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

async function deleteNotification() {
    const notificationId = document.getElementById("notificationId").value

    const deleteResponse = await fetch(`/api/delete-notification/${notificationId}`, {
        method: "delete"
    })

    document.getElementById("notificationId").value = ""
}

const reloadConfigButton = document.getElementById("reloadConfig");
reloadConfigButton.addEventListener('click', reloadConfig);

const verifyConfigButton = document.getElementById("verifyConfig");
verifyConfigButton.addEventListener('click', verifyConfig);

const deleteNotificationButton = document.getElementById("deleteNotification");
deleteNotificationButton.addEventListener('click', deleteNotification);