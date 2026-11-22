--[[
  NexusHeartbeat — пинг сайта «Север Оператив»
  Куда: ServerScriptService → Script (Server)

  Без этого скрипта сайт через несколько минут считает сервер offline,
  даже если place открыт. Кнопки обновляют связь только в момент клика.
]]

local HttpService = game:GetService("HttpService")

-- ===== НАСТРОЙКИ (те же, что у кнопок) =====
local SITE_API_URL = "ВСТАВЬ_URL_САЙТА" -- без / в конце
local SITE_API_KEY = "ВСТАВЬ_STATUS_API_KEY"
local INTERVAL = 45 -- секунд между пингами
-- ==========================================

if SITE_API_URL == "ВСТАВЬ_URL_САЙТА" or SITE_API_KEY == "ВСТАВЬ_STATUS_API_KEY" then
	warn("[NexusHeartbeat] Заполни SITE_API_URL и SITE_API_KEY")
end

local function ping()
	local ok, err = pcall(function()
		local response = HttpService:RequestAsync({
			Url = SITE_API_URL .. "/api/roblox/heartbeat",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["Authorization"] = "Bearer " .. SITE_API_KEY,
			},
			Body = "{}",
		})
		if response.StatusCode < 200 or response.StatusCode >= 300 then
			warn("[NexusHeartbeat] HTTP", response.StatusCode, response.Body)
		else
			print("[NexusHeartbeat] ok")
		end
	end)
	if not ok then
		warn("[NexusHeartbeat] error:", err)
	end
end

ping()
while true do
	task.wait(INTERVAL)
	ping()
end
