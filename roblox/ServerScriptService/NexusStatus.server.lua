--[[
  Север Оператив — серверный скрипт Roblox
  Размещение: ServerScriptService / NexusStatus.server.lua

  Отправляет heartbeat и обновления статусов на сайт.
  API-ключ хранится ТОЛЬКО здесь (сервер). Не кладите его в LocalScript.
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

----------------------------------------------------------------------
-- КОНФИГУРАЦИЯ (заполните перед публикацией)
----------------------------------------------------------------------

-- URL вашего API (без слэша в конце)
local API_URL = "https://alarm.nexusroleplay.ru"

-- Секретный ключ = значение STATUS_API_KEY на сервере сайта
-- НИКОГДА не публикуйте этот ключ в клиентских скриптах
local API_KEY = "PASTE_YOUR_STATUS_API_KEY_HERE"

-- Интервал heartbeat (секунды)
local HEARTBEAT_INTERVAL = 30

-- Таймаут HTTP-запроса (секунды)
local REQUEST_TIMEOUT = 10

-- Повторы при ошибке
local MAX_RETRIES = 3
local RETRY_BASE_DELAY = 2 -- секунды, растёт экспоненциально

-- UserId администраторов, которым разрешено менять статусы
-- Добавьте свои ID
local ADMIN_USER_IDS = {
	-- 123456789,
	-- 987654321,
}

----------------------------------------------------------------------
-- Внутреннее
----------------------------------------------------------------------

local RemoteFolder = ReplicatedStorage:FindFirstChild("NexusStatusRemotes")
if not RemoteFolder then
	RemoteFolder = Instance.new("Folder")
	RemoteFolder.Name = "NexusStatusRemotes"
	RemoteFolder.Parent = ReplicatedStorage
end

local SetStatusRemote = RemoteFolder:FindFirstChild("SetStatus")
if not SetStatusRemote then
	SetStatusRemote = Instance.new("RemoteEvent")
	SetStatusRemote.Name = "SetStatus"
	SetStatusRemote.Parent = RemoteFolder
end

local function isAdmin(player)
	if not player then
		return false
	end
	for _, id in ipairs(ADMIN_USER_IDS) do
		if player.UserId == id then
			return true
		end
	end
	-- На Studio можно разрешить владельцу места
	if game:GetService("RunService"):IsStudio() then
		return true
	end
	return false
end

local function httpRequest(method, path, bodyTable)
	local url = API_URL .. path
	local body = bodyTable and HttpService:JSONEncode(bodyTable) or nil

	local attempt = 0
	while attempt < MAX_RETRIES do
		attempt = attempt + 1
		local ok, result = pcall(function()
			return HttpService:RequestAsync({
				Url = url,
				Method = method,
				Headers = {
					["Content-Type"] = "application/json",
					["Authorization"] = "Bearer " .. API_KEY,
					["X-Api-Key"] = API_KEY,
				},
				Body = body,
			})
		end)

		if ok and result then
			if result.Success or (result.StatusCode and result.StatusCode >= 200 and result.StatusCode < 300) then
				local decoded = nil
				if result.Body and result.Body ~= "" then
					local decodeOk, data = pcall(function()
						return HttpService:JSONDecode(result.Body)
					end)
					if decodeOk then
						decoded = data
					end
				end
				return true, decoded, result.StatusCode
			else
				warn("[NexusStatus] HTTP", result.StatusCode, result.Body)
			end
		else
			warn("[NexusStatus] Request failed:", result)
		end

		if attempt < MAX_RETRIES then
			local delay = RETRY_BASE_DELAY * (2 ^ (attempt - 1))
			task.wait(delay)
		end
	end

	return false, nil, nil
end

----------------------------------------------------------------------
-- Публичный API модуля (можно вызывать из других ServerScript)
----------------------------------------------------------------------

local NexusStatus = {}

--- Отправить heartbeat
function NexusStatus.Heartbeat()
	local ok = httpRequest("POST", "/api/roblox/heartbeat", {})
	if ok then
		-- print("[NexusStatus] Heartbeat OK")
	end
	return ok
end

--- Установить статус категории
--- category: "drone" | "rocket"
--- status: "green" | "red"
--- source: необязательная строка
function NexusStatus.SetStatus(category, status, source)
	assert(category == "drone" or category == "rocket", "category must be drone or rocket")
	assert(status == "green" or status == "red", "status must be green or red")

	local payload = {
		category = category,
		status = status,
		source = source or "roblox",
	end

	local ok, data = httpRequest("POST", "/api/roblox/status", payload)
	if ok then
		print("[NexusStatus] Status updated:", category, status)
	else
		warn("[NexusStatus] Failed to update status:", category, status)
	end
	return ok, data
end

----------------------------------------------------------------------
-- Обработка RemoteEvent от GUI (только админы)
----------------------------------------------------------------------

SetStatusRemote.OnServerEvent:Connect(function(player, category, status)
	if not isAdmin(player) then
		warn("[NexusStatus] Unauthorized status change attempt by", player and player.Name)
		return
	end
	if type(category) ~= "string" or type(status) ~= "string" then
		return
	end
	category = string.lower(category)
	status = string.lower(status)
	if (category ~= "drone" and category ~= "rocket") then
		return
	end
	if (status ~= "green" and status ~= "red") then
		return
	end

	NexusStatus.SetStatus(category, status, "admin:" .. player.Name)
end)

----------------------------------------------------------------------
-- Heartbeat loop
----------------------------------------------------------------------

task.spawn(function()
	-- Небольшая задержка после старта сервера
	task.wait(3)
	while true do
		NexusStatus.Heartbeat()
		task.wait(HEARTBEAT_INTERVAL)
	end
end)

-- Экспорт на случай, если другие серверные скрипты захотят вызывать напрямую
_G.NexusStatus = NexusStatus

print("[NexusStatus] Server module loaded")
