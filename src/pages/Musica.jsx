import PlaylistsCard from '../components/PlaylistsCard.jsx';
import SpotifyCard from '../components/SpotifyCard.jsx';
import './PlanoB.css';
import './Musica.css';

export default function Musica() {
  return (
    <div className="planob-page">
      <h1>Música</h1>
      <p className="planob-sub">Spotify nas Alexas da sala.</p>

      <PlaylistsCard />
      <SpotifyCard />
    </div>
  );
}
