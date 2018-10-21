import Note, { INote } from '../../models/note';
import { IUser, isLocalUser } from '../../models/user';
import { publishNoteStream } from '../../stream';
import renderDelete from '../../remote/activitypub/renderer/delete';
import pack from '../../remote/activitypub/renderer';
import { deliver } from '../../queue';
import Following from '../../models/following';
import renderTombstone from '../../remote/activitypub/renderer/tombstone';
import { notesStats } from '../stats';
import config from '../../config';
import NoteUnread from '../../models/note-unread';
import read from './read';

/**
 * 投稿を削除します。
 * @param user 投稿者
 * @param note 投稿
 */
export default async function(user: IUser, note: INote) {
	const deletedAt = new Date();

	await Note.update({
		_id: note._id,
		userId: user._id
	}, {
		$set: {
			deletedAt: deletedAt,
			text: null,
			tags: [],
			fileIds: [],
			poll: null,
			geo: null,
			cw: null
		}
	});

	publishNoteStream(note._id, 'deleted', {
		deletedAt: deletedAt
	});

	// この投稿が関わる未読通知を削除
	NoteUnread.find({
		noteId: note._id
	}).then(unreads => {
		unreads.forEach(unread => {
			read(unread.userId, unread.noteId);
		});
	});

	//#region ローカルの投稿なら削除アクティビティを配送
	if (isLocalUser(user)) {
		const content = pack(renderDelete(renderTombstone(`${config.url}/notes/${note._id}`), user));

		const followings = await Following.find({
			followeeId: user._id,
			'_follower.host': { $ne: null }
		});

		followings.forEach(following => {
			deliver(user, content, following._follower.inbox);
		});
	}
	//#endregion

	// 統計を更新
	notesStats.update(note, false);
}
