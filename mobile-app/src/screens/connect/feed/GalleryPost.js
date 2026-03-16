import React, { memo, useMemo } from 'react';
import { ScrollView, Image, StyleSheet, Dimensions, View } from 'react-native';
import { theme, RADIUS } from '../../../theme/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const IMAGE_WIDTH = Math.max(260, SCREEN_WIDTH - 48);

function GalleryPostComponent({ post }) {
    const images = useMemo(() => {
        if (Array.isArray(post?.images) && post.images.length > 0) {
            return post.images;
        }
        if (post?.mediaUrl) {
            return [post.mediaUrl];
        }
        return [];
    }, [post?.images, post?.mediaUrl]);

    if (images.length === 0) return null;

    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroller}>
            {images.map((uri, index) => (
                <View key={`${post?._id || 'gallery'}-${index}`} style={styles.imageWrap}>
                    <Image source={{ uri }} style={styles.image} />
                </View>
            ))}
        </ScrollView>
    );
}

export default memo(GalleryPostComponent);

const styles = StyleSheet.create({
    scroller: {
        marginTop: 0,
        marginBottom: 0,
    },
    imageWrap: {
        borderRadius: 18,
        overflow: 'hidden',
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#ede6fb',
        backgroundColor: '#f6f3ff',
        shadowColor: '#2a1858',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 14,
        elevation: 2,
    },
    image: {
        width: IMAGE_WIDTH,
        height: IMAGE_WIDTH,
        backgroundColor: theme.borderMedium,
    },
});
