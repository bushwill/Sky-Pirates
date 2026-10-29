import { GameView } from './game/GameView.js';
import { RoomClient } from './network/RoomClient.js';
import { RoomLobby } from './ui/RoomLobby.js';
import './style.css';

const roomClient = new RoomClient();
let roomLobby;
const gameView = new GameView(document.querySelector('#room-game'), roomClient);
roomLobby = new RoomLobby(roomClient, gameView);
