import React, { useEffect, useState, useCallback } from 'react';
import { IoLocationOutline, IoMicOutline } from 'react-icons/io5';
import VideoRecorder from '../../../Components/VideoRecorder';
import browserSessionApi from '../../../utils/browserSessionApi';

const Profiles = () => {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editingIndex, setEditingIndex] = useState(-1);
    const [editFormData, setEditFormData] = useState({});
    const [showRecorder, setShowRecorder] = useState(false);

    const fetchProfile = useCallback(async () => {
        try {
            const { data } = await browserSessionApi.get('/api/users/profile', {
                showGlobalErrorNotice: true,
            });

            if (data.profile) {
                setProfile(data.profile);
            }
        } catch (error) {
            console.warn("Error fetching profile:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    const handleEditClick = (index, role) => {
        setEditingIndex(index);
        setEditFormData({
            roleName: role.roleName,
            experienceInRole: role.experienceInRole || 0,
            expectedSalary: role.expectedSalary || 0,
            skills: role.skills ? role.skills.join(', ') : '',
            description: `${role.experienceInRole} years of experience in ${role.roleName}.`
        });
    };

    const handleSave = async () => {
        try {
            const updatedRoles = [...profile.roleProfiles];
            updatedRoles[editingIndex] = {
                ...updatedRoles[editingIndex],
                roleName: editFormData.roleName,
                experienceInRole: parseInt(editFormData.experienceInRole) || 0,
                expectedSalary: parseInt(editFormData.expectedSalary) || 0,
                skills: editFormData.skills.split(',').map(s => s.trim()).filter(s => s.length > 0)
            };

            const { data } = await browserSessionApi.put('/api/users/profile', { roleProfiles: updatedRoles });

            if (data.profile) {
                setProfile(data.profile);
                setEditingIndex(-1);
            }
        } catch (error) {
            console.warn("Error updating profile:", error);
        }
    };

    if (loading) return <div className="p-6 text-indigo-600 text-center font-medium">Loading...</div>;

    return (
        <div className="p-4 bg-white min-h-screen pb-24">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <h1 className="text-3xl font-bold text-gray-900">My Profiles</h1>
                <button
                    onClick={() => setShowRecorder(true)}
                    className="bg-purple-600 text-white px-4 py-2 rounded-full font-semibold flex items-center gap-2 shadow-lg hover:bg-purple-700 transition"
                >
                    <IoMicOutline size={20} />
                    Create New
                </button>
            </div>
            <p className="text-gray-500 text-sm mb-6">Manage your diverse skillsets and job-specific profiles.</p>

            {/* Recorder Modal */}
            {showRecorder && (
                <div className="fixed inset-0 z-[3000] bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-lg p-4 relative">
                        <button
                            onClick={() => setShowRecorder(false)}
                            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl font-bold"
                        >
                            ✕
                        </button>
                        <VideoRecorder onUploadSuccess={() => {
                            setShowRecorder(false);
                            fetchProfile();
                        }} />
                    </div>
                </div>
            )}

            {/* Cards List */}
            <div className="space-y-4">
                {profile?.roleProfiles?.map((role, index) => {
                    const isEditing = editingIndex === index;

                    return (
                        <div key={index} className="border border-purple-200 rounded-2xl p-5 shadow-sm bg-white relative hover:shadow-md transition-shadow">

                            {!isEditing ? (
                                <>
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h2 className="text-xl font-bold text-gray-900">{role.roleName}</h2>
                                            <p className="text-purple-600 font-semibold text-sm">₹{role.expectedSalary ? role.expectedSalary.toLocaleString() : 0} / month</p>
                                        </div>
                                        {index === 0 && (
                                            <span className="bg-purple-50 text-purple-600 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">Default</span>
                                        )}
                                    </div>

                                    <p className="text-gray-600 text-sm leading-relaxed mb-4">
                                        {role.experienceInRole || 0} years of experience working as a {role.roleName}.
                                        {profile.city && ` Based in ${profile.city}.`}
                                    </p>

                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {role.skills?.map((skill, i) => (
                                            <span key={i} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wide">
                                                {skill}
                                            </span>
                                        ))}
                                    </div>

                                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                        <div className="flex items-center text-gray-400 text-xs font-medium">
                                            <IoLocationOutline className="mr-1" size={14} />
                                            {role.experienceInRole || 0} Years Exp. • {profile.city || 'Unknown'}
                                        </div>
                                        <button
                                            onClick={() => handleEditClick(index, role)}
                                            className="text-purple-600 font-bold text-xs uppercase tracking-wider hover:text-purple-800"
                                        >
                                            Edit
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <h2 className="text-lg font-bold text-gray-800">Editing Profile</h2>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase">Role Name</label>
                                        <input
                                            type="text"
                                            className="w-full border border-gray-300 rounded p-2 text-sm mt-1 focus:outline-none focus:border-purple-500"
                                            value={editFormData.roleName}
                                            onChange={(e) => setEditFormData({ ...editFormData, roleName: e.target.value })}
                                        />
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="w-1/2">
                                            <label className="text-xs font-bold text-gray-500 uppercase">Experience (Yrs)</label>
                                            <input
                                                type="number"
                                                className="w-full border border-gray-300 rounded p-2 text-sm mt-1"
                                                value={editFormData.experienceInRole}
                                                onChange={(e) => setEditFormData({ ...editFormData, experienceInRole: e.target.value })}
                                            />
                                        </div>
                                        <div className="w-1/2">
                                            <label className="text-xs font-bold text-gray-500 uppercase">Salary (₹)</label>
                                            <input
                                                type="number"
                                                className="w-full border border-gray-300 rounded p-2 text-sm mt-1"
                                                value={editFormData.expectedSalary}
                                                onChange={(e) => setEditFormData({ ...editFormData, expectedSalary: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase">Skills (Comma Separated)</label>
                                        <input
                                            type="text"
                                            className="w-full border border-gray-300 rounded p-2 text-sm mt-1"
                                            value={editFormData.skills}
                                            onChange={(e) => setEditFormData({ ...editFormData, skills: e.target.value })}
                                        />
                                    </div>

                                    <div className="flex justify-end gap-3 pt-2">
                                        <button
                                            onClick={() => setEditingIndex(-1)}
                                            className="px-4 py-2 text-gray-500 text-sm font-bold hover:bg-gray-50 rounded"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            className="px-4 py-2 bg-purple-600 text-white text-sm font-bold rounded shadow hover:bg-purple-700"
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {(!profile?.roleProfiles || profile.roleProfiles.length === 0) && (
                    <div className="text-center py-10 text-gray-400">
                        <p>No profiles found. Create one to get started!</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Profiles;
