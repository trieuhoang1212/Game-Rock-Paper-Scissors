using UnityEngine;
using SocketIOClient;
using System;
using TMPro;
using System.Collections.Generic;
using UnityEngine.UI;
using System.Collections;

public class GamePlay : MonoBehaviour
{
    private SocketIOUnity socket;
    public Button SearchGame;
    public Button PlayGame;
    public TMP_InputField RoomIDText;

    public Button RockButton;
    public Button PaperButton;
    public Button ScissorsButton;

    // Result Display:
    public TMP_Text ResultText;

    // Previously you used images; now using text labels for choices
    
    public TMP_Text MyChoiceText;
    public TMP_Text OpponentChoiceText;

    public Button MainMenuButton;

    // Waiting text
    public TMP_Text WaitingText;

    private readonly Queue<Action> mainThreadActions = new Queue<Action>();

    public static GamePlay Instance { get; private set; }

    void Awake()
    {
        if (Instance == null) { Instance = this; DontDestroyOnLoad(gameObject); }
        else { Destroy(gameObject); return; }
    }

    void Start()
    {
        var uri = new Uri("http://localhost:8000");
        socket = new SocketIOUnity(uri, new SocketIOOptions
        {
            Query = new Dictionary<string, string> { { "token", "UNITY" } },
            Transport = SocketIOClient.Transport.TransportProtocol.WebSocket
        });

        socket.OnConnected += (s, e) => Debug.Log("Connected to server!");
        socket.OnError += (s, e) => Debug.LogError($"Socket Error: {e}");
        socket.OnDisconnected += (s, e) => Debug.Log($"Disconnected: {e}");

        socket.On("playerSearching", response =>
        {
            EnqueueOnMainThread(() =>
            {
                var data = response.GetValue<Dictionary<string, object>>();
                int playerNumber = 1;
                var pn = data.ContainsKey("playerNumber") ? data["playerNumber"]?.ToString() : null;
                if (!string.IsNullOrEmpty(pn) && int.TryParse(pn, out int t)) playerNumber = t;
                string roomID = data.ContainsKey("roomID") ? data["roomID"]?.ToString().Trim('"') : "";
                Debug.Log($"[playerSearching] Player {playerNumber}, room: {roomID}");
                if (RoomIDText) RoomIDText.text = roomID;
                if (WaitingText) { WaitingText.gameObject.SetActive(true); WaitingText.text = "Waiting for opponent..."; }
            });
        });

        socket.On("startGame", response =>
        {
            EnqueueOnMainThread(() =>
            {
                var data = response.GetValue<Dictionary<string, object>>();
                int playerNumber = 1;
                var pn = data.ContainsKey("playerNumber") ? data["playerNumber"]?.ToString() : null;
                if (!string.IsNullOrEmpty(pn) && int.TryParse(pn, out int t)) playerNumber = t;
                string roomID = data.ContainsKey("roomID") ? data["roomID"]?.ToString().Trim('"') : "";
                Debug.Log($"[startGame] You are Player {playerNumber} in room {roomID}");

                // hide post-round UI, hide waiting, show choices
                WaitingText.gameObject.SetActive(false);
                MainMenuButton.gameObject.SetActive(false);
                HideChoicesAndResult();
                EnableChoices(true);
            });
        });

        socket.On("gameResult", response =>
        {
            EnqueueOnMainThread(() =>
            {
                var data = response.GetValue<Dictionary<string, object>>();
                string myChoice = data.ContainsKey("myChoice") ? data["myChoice"].ToString() : "";
                string opponentChoice = data.ContainsKey("opponentChoice") ? data["opponentChoice"].ToString() : "";
                string result = data.ContainsKey("result") ? data["result"].ToString() : "";
                int myScore = 0;
                int oppScore = 0;
                var ms = data.ContainsKey("myScore") ? data["myScore"]?.ToString() : null;
                var os = data.ContainsKey("opponentScore") ? data["opponentScore"]?.ToString() : null;
                if (!string.IsNullOrEmpty(ms)) int.TryParse(ms, out myScore);
                if (!string.IsNullOrEmpty(os)) int.TryParse(os, out oppScore);

                Debug.Log($"[gameResult] myChoice={myChoice}, opp={opponentChoice}, result={result}, myScore={myScore}, oppScore={oppScore}");

                // show choices as text
                if (MyChoiceText) { MyChoiceText.text = NiceChoice(myChoice); MyChoiceText.gameObject.SetActive(true); }
                if (OpponentChoiceText) { OpponentChoiceText.text = NiceChoice(opponentChoice); OpponentChoiceText.gameObject.SetActive(true); }
                // show result
                if (ResultText) { ResultText.text = result; ResultText.gameObject.SetActive(true); }
                SetResultColor(result);

                // show PlayAgain + MainMenu buttons
                if (MainMenuButton) MainMenuButton.gameObject.SetActive(true);

                // ensure choices disabled
                EnableChoices(false);
            });
        });

        socket.On("playerReady", response =>
        {
            EnqueueOnMainThread(() =>
            {
                // optional: notify UI that opponent is ready
                Debug.Log("[playerReady] someone is ready");
                if (WaitingText) { WaitingText.gameObject.SetActive(true); WaitingText.text = "Đối thủ đã sẵn sàng..."; }
            });
        });

        socket.On("waitingForOpponent", response =>
        {
            EnqueueOnMainThread(() =>
            {
                Debug.Log("[waitingForOpponent] waiting...");
                if (WaitingText) { WaitingText.gameObject.SetActive(true); WaitingText.text = "Chờ đối thủ đồng ý..."; }
            });
        });

        socket.On("playerLeft", response =>
        {
            EnqueueOnMainThread(() =>
            {
                Debug.Log("[playerLeft] opponent left");
                // show main menu or feedback
                ShowMainMenuUI();
            });
        });

        // Connect and bind UI
        socket.ConnectAsync();
        SearchGame.onClick.AddListener(PlayerSearching);
        PlayGame.onClick.AddListener(PlayGameFunc);

        RockButton.onClick.AddListener(() => SubmitChoice("rock"));
        PaperButton.onClick.AddListener(() => SubmitChoice("paper"));
        ScissorsButton.onClick.AddListener(() => SubmitChoice("scissor"));

        MainMenuButton.onClick.AddListener(OnMainMenuPressed);
    
        // initial UI state
        EnableChoices(false);
        HideChoicesAndResult();
        if (WaitingText) WaitingText.gameObject.SetActive(false);
        MainMenuButton.gameObject.SetActive(false);
    }

    void Update()
    {
        lock (mainThreadActions)
        {
            while (mainThreadActions.Count > 0)
            {
                try { mainThreadActions.Dequeue()?.Invoke(); }
                catch (Exception ex) { Debug.LogError($"Error executing action: {ex}"); }
            }
        }
    }

    private void EnqueueOnMainThread(Action a)
    {
        lock (mainThreadActions) mainThreadActions.Enqueue(a);
    }

    private void HideChoicesAndResult()
    {
        EnableChoices(false);
        if (ResultText) { ResultText.gameObject.SetActive(false); ResultText.text = ""; }
        if (MyChoiceText) { MyChoiceText.gameObject.SetActive(false); MyChoiceText.text = ""; }
        if (OpponentChoiceText)
        {
            OpponentChoiceText.gameObject.SetActive(false); OpponentChoiceText.text = "";
        }
    }

    private void ShowMainMenuUI()
    {
        if (SearchGame) SearchGame.gameObject.SetActive(true);
        if (PlayGame) PlayGame.gameObject.SetActive(true);
        if (RoomIDText) RoomIDText.gameObject.SetActive(true);
        if (WaitingText) WaitingText.gameObject.SetActive(false);
        EnableChoices(false);
        MainMenuButton.gameObject.SetActive(false);
    }

    private void EnableChoices(bool enable)
    {
        if (RockButton) RockButton.gameObject.SetActive(enable);
        if (PaperButton) PaperButton.gameObject.SetActive(enable);
        if (ScissorsButton) ScissorsButton.gameObject.SetActive(enable);
    }

    void PlayerSearching()
    {
        string roomID = Guid.NewGuid().ToString();
        socket.EmitAsync("createRoom", roomID);
        Debug.Log($"Searching for game in room: {roomID}");
        // hide only choices + result, show waiting
        HideChoicesAndResult();
        if (WaitingText) { WaitingText.gameObject.SetActive(true); WaitingText.text = "Waiting for opponent..."; }
        if (RoomIDText) RoomIDText.text = roomID;
    }

    void PlayGameFunc()
    {
        string roomID = RoomIDText.text;
        if (string.IsNullOrEmpty(roomID)) { Debug.LogWarning("RoomID empty"); return; }
        socket.EmitAsync("joinRoom", roomID);
        Debug.Log($"Joining room: {roomID}");
        // hide choices; show waiting for opponent to press Play
        HideChoicesAndResult();
        if (WaitingText) { WaitingText.gameObject.SetActive(true); WaitingText.text = "waiting for opponent..."; }
    }

    private void SubmitChoice(string choice)
    {
        EnableChoices(false);
        var data = new Dictionary<string, object> { { "roomID", RoomIDText.text }, { "choice", choice } };
        Debug.Log($"Submitting choice: {choice} to room {RoomIDText.text}");
        socket.EmitAsync("submitChoice", data);
    }

    private void OnPlayAgainPressed()
    {
        // tell server we want to play again, then wait for opponent
        if (WaitingText) { WaitingText.gameObject.SetActive(true); WaitingText.text = "Waiting for opponent play..."; }
        socket.EmitAsync("playAgain", new Dictionary<string, object> { { "roomID", RoomIDText.text } });
    }

    private void OnMainMenuPressed()
    {
        // notify server and go back to main menu
        socket.EmitAsync("exitGame", new Dictionary<string, object> { { "roomID", RoomIDText.text } });
        ShowMainMenuUI();
        // Reset scores on client side
    }
    private string NiceChoice(string choice)
    {
        return choice switch
        {
            "rock" => "ROCK",
            "paper" => "PAPER",
            "scissor" => "SCISSOR",
            _ => "Unknown"
        };
    }

    private void SetResultColor(string result)
    {
        if (!ResultText) return;
        if (result == "WIN") ResultText.color = Color.green;
        else if (result == "LOSE") ResultText.color = Color.red;
        else ResultText.color = Color.yellow;
    }

    void OnDestroy()
    {
        socket?.DisconnectAsync();
        socket?.Dispose();
    }
}
