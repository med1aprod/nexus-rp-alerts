--[[
  Север Оператив — LocalScript для GUI-кнопок
  Пример размещения:
    StarterGui
      └── NexusStatus (ScreenGui)
            ├── LocalScript  ← этот файл
            ├── DroneGreen (TextButton)
            ├── DroneRed (TextButton)
            ├── RocketGreen (TextButton)
            └── RocketRed (TextButton)

  LocalScript НЕ содержит API-ключ.
  Он только шлёт RemoteEvent на сервер.
  Права проверяются на сервере.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local gui = script.Parent

-- Ждём RemoteEvent
local remotes = ReplicatedStorage:WaitForChild("NexusStatusRemotes", 30)
if not remotes then
	warn("[NexusStatus Local] Remotes folder not found")
	return
end

local SetStatus = remotes:WaitForChild("SetStatus", 10)
if not SetStatus then
	warn("[NexusStatus Local] SetStatus RemoteEvent not found")
	return
end

local function bind(buttonName, category, status)
	local btn = gui:FindFirstChild(buttonName)
	if not btn then
		-- Кнопка может отсутствовать — это нормально, если вы используете свои имена
		return
	end
	if not btn:IsA("GuiButton") then
		return
	end
	btn.MouseButton1Click:Connect(function()
		SetStatus:FireServer(category, status)
	end)
end

-- Привязка стандартных имён кнопок
bind("DroneGreen", "drone", "green")
bind("DroneRed", "drone", "red")
bind("RocketGreen", "rocket", "green")
bind("RocketRed", "rocket", "red")

-- Если у вас другие имена кнопок — добавьте вызовы bind() выше
-- или подключите вручную:
-- myButton.MouseButton1Click:Connect(function()
--   SetStatus:FireServer("drone", "red")
-- end)

print("[NexusStatus Local] Buttons bound (if present)")
