async function reloadConfig() {
    const reloadResponse = await fetch("/api/config/reload")
    const reload = await reloadResponse.text()

    console.log(reload)
}

async function verifyConfig() {
    const verifyResponse = await fetch("/api/config/verify")
    const verify = await verifyResponse.json()

    console.log(verify)
}

async function deleteNotification() {
    const notificationId = document.getElementById("notificationId").value

    const deleteResponse = await fetch(`/api/notification/${notificationId}`, {
        method: "delete"
    })

    document.getElementById("notificationId").value = ""
}

async function listNotifications() {
    const listResponse = await fetch(`/api/notification/list`)
    const list = listResponse.json()

    console.log(list)
}

const reloadConfigButton = document.getElementById("reloadConfig");
reloadConfigButton.addEventListener('click', reloadConfig);

const verifyConfigButton = document.getElementById("verifyConfig");
verifyConfigButton.addEventListener('click', verifyConfig);

const listNotificationsButton = document.getElementById("listNotifications");
listNotificationsButton.addEventListener('click', listNotifications);

const deleteNotificationButton = document.getElementById("deleteNotification");
deleteNotificationButton.addEventListener('click', deleteNotification);